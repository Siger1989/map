package com.guanyun.weather;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import java.net.Socket;

/** Bounded native transport for user-configured public raster tiles. */
final class MapTileProxy {
    static final int MAX_BYTES = 8 * 1024 * 1024;
    static final int TIMEOUT_MS = 12000;
    private static final int MAX_HEADER_BYTES = 32768;
    private static final int MAX_URL_LENGTH = 8192;
    private static final int MAX_REDIRECTS = 3;
    private static final java.util.concurrent.ScheduledExecutorService DEADLINE_CLOSER = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "map-tile-timeout"); thread.setDaemon(true); return thread;
    });
    private static final java.util.concurrent.ExecutorService DNS_LOOKUP = java.util.concurrent.Executors.newFixedThreadPool(2, r -> {
        Thread thread = new Thread(r, "map-tile-dns"); thread.setDaemon(true); return thread;
    });

    static final class Tile {
        final byte[] bytes;
        final String mime;
        Tile(byte[] bytes, String mime) { this.bytes = bytes; this.mime = mime; }
    }

    static final class TileException extends IOException {
        final int status;
        final String diagnostic;
        TileException(int status, String diagnostic, String message) { super(message); this.status = status; this.diagnostic=diagnostic; }
    }

    private static final class Target {
        final URI uri;
        final String host;
        final int port;
        Target(URI uri, String host, int port) { this.uri = uri; this.host = host; this.port = port; }
    }

    static final class UpstreamResponse {
        final int status;
        final String location;
        final Tile tile;
        UpstreamResponse(int status, String location, Tile tile) { this.status=status; this.location=location; this.tile=tile; }
    }
    interface PinnedAttempt { UpstreamResponse run(InetAddress address,long attemptDeadline) throws IOException; }

    static Tile fetch(String rawUrl) throws IOException {
        long deadline = System.nanoTime() + TIMEOUT_MS * 1_000_000L;
        String current = rawUrl;
        for (int hop=0; hop<=MAX_REDIRECTS; hop++) {
            final Target target;
            try { target = validate(current); }
            catch (IOException error) { throw new TileException(hop==0?400:502, "url", "Invalid tile URL"); }
            UpstreamResponse response = request(target, deadline);
            if (response.tile != null) return response.tile;
            if (!isRedirect(response.status) || response.location == null || response.location.isEmpty() || hop==MAX_REDIRECTS)
                throw new TileException(502, "upstream_http", "Map tile unavailable");
            try { current = resolveRedirect(current,response.location); }
            catch (IOException error) { throw new TileException(502, "upstream_http", "Invalid tile redirect"); }
        }
        throw new TileException(502, "upstream_http", "Map tile unavailable");
    }

    private static UpstreamResponse request(Target target,long deadline) throws IOException {
        InetAddress[] addresses;
        java.util.concurrent.Future<InetAddress[]> lookup = DNS_LOOKUP.submit(() -> InetAddress.getAllByName(target.host));
        try { addresses = lookup.get(remainingMs(deadline), java.util.concurrent.TimeUnit.MILLISECONDS); }
        catch (IOException error) { lookup.cancel(true); throw new TileException(502,"timeout","Tile request timed out"); }
        catch (java.util.concurrent.TimeoutException error) { lookup.cancel(true); throw new TileException(502, "timeout", "Tile request timed out"); }
        catch (java.util.concurrent.ExecutionException error) {
            Throwable cause=error.getCause();
            if (cause instanceof UnknownHostException) throw new TileException(502, "dns", "Tile host unavailable");
            throw new TileException(502, "dns", "Tile host unavailable");
        } catch (InterruptedException error) { lookup.cancel(true); Thread.currentThread().interrupt(); throw new TileException(502, "timeout", "Tile request interrupted"); }
        return tryAddresses(addresses,deadline,(address,attemptDeadline)->requestPinned(target,address,attemptDeadline));
    }

    static UpstreamResponse tryAddresses(InetAddress[] addresses,long deadline,PinnedAttempt attempt) throws IOException {
        requirePublicAddresses(addresses);
        IOException lastFailure=null;
        for (int i=0;i<addresses.length;i++) {
            try { remainingMs(deadline); }
            catch (IOException error) { throw new TileException(502,"timeout","Tile request timed out"); }
            int remainingCandidates=addresses.length-i;
            long remainingNanos=deadline-System.nanoTime();
            long slice=remainingCandidates==1?remainingNanos:Math.min(4_000_000_000L,Math.max(1_000_000_000L,remainingNanos/remainingCandidates));
            long attemptDeadline=Math.min(deadline,System.nanoTime()+slice);
            try { return attempt.run(addresses[i],attemptDeadline); }
            catch (IOException error) { lastFailure=error; }
        }
        if (lastFailure instanceof TileException) throw lastFailure;
        throw classifyAttemptFailure(lastFailure,deadline);
    }

    static TileException classifyAttemptFailure(IOException failure,long deadline) {
        if (failure instanceof java.net.SocketTimeoutException || System.nanoTime()>=deadline)
            return new TileException(502,"timeout","Tile request timed out");
        if (failure instanceof javax.net.ssl.SSLException)
            return new TileException(502,"tls","Tile TLS connection failed");
        if (failure instanceof java.net.ConnectException || failure instanceof java.net.NoRouteToHostException || failure instanceof java.net.SocketException)
            return new TileException(502,"connect","Tile connection failed");
        return new TileException(502,"upstream_http","Tile host unavailable");
    }

    static void requirePublicAddresses(InetAddress[] addresses) throws TileException {
        if (addresses==null || addresses.length==0) throw new TileException(502,"dns","Tile host unavailable");
        // Check the complete answer set before attempts so a mixed public/private set cannot fall through.
        for (InetAddress address : addresses) if (address==null || !isPublicAddress(address)) throw new TileException(502,"blocked","Tile host rejected");
    }

    private static UpstreamResponse requestPinned(Target target,InetAddress pinned,long deadline) throws IOException {
        final int remaining;
        try { remaining=remainingMs(deadline); }
        catch (IOException error) { throw new TileException(502,"timeout","Tile request timed out"); }
        final Socket transport = new Socket();
        Socket socket = transport;
        String phase="connect";
        java.util.concurrent.ScheduledFuture<?> watchdog = DEADLINE_CLOSER.schedule(() -> {
            try { transport.close(); } catch (IOException ignored) { }
        }, remaining, java.util.concurrent.TimeUnit.MILLISECONDS);
        try {
            socket.connect(new java.net.InetSocketAddress(pinned, target.port), remaining);
            socket.setSoTimeout(Math.min(TIMEOUT_MS, remainingMs(deadline)));
            boolean secure = "https".equalsIgnoreCase(target.uri.getScheme());
            if (secure) {
                phase="tls";
                SSLSocket tls = (SSLSocket) ((SSLSocketFactory) SSLSocketFactory.getDefault())
                    .createSocket(socket, target.host, target.port, true);
                SSLParameters parameters = tls.getSSLParameters();
                parameters.setEndpointIdentificationAlgorithm("HTTPS");
                tls.setSSLParameters(parameters);
                tls.setSoTimeout(Math.min(TIMEOUT_MS, remainingMs(deadline)));
                tls.startHandshake();
                socket = tls;
            }
            phase="upstream_http";
            OutputStream out = socket.getOutputStream();
            String path = target.uri.getRawPath();
            if (path == null || path.isEmpty()) path = "/";
            if (target.uri.getRawQuery() != null) path += "?" + target.uri.getRawQuery();
            String hostHeader = target.host.indexOf(':') >= 0 ? "[" + target.host + "]" : target.host;
            if (!(secure && target.port == 443) && !(!secure && target.port == 80)) hostHeader += ":" + target.port;
            String request = "GET " + path + " HTTP/1.1\r\nHost: " + hostHeader +
                "\r\nAccept: image/avif,image/webp,image/png,image/jpeg,image/gif\r\nAccept-Encoding: identity\r\n" +
                "User-Agent: Shantu-Android-Map-Tile/1.0\r\nConnection: close\r\n\r\n";
            out.write(request.getBytes(StandardCharsets.US_ASCII));
            out.flush();
            InputStream in = new DeadlineInputStream(socket.getInputStream(), socket, deadline);
            return parseResponse(in);
        } catch (TileException error) {
            throw error;
        } catch (IOException error) {
            if (error instanceof java.net.SocketTimeoutException || System.nanoTime()>=deadline)
                throw new TileException(502,"timeout","Tile request timed out");
            if ("connect".equals(phase)) throw new TileException(502,"connect","Tile connection failed");
            if ("tls".equals(phase)) throw new TileException(502,"tls","Tile TLS connection failed");
            throw new TileException(502,"upstream_http","Tile response unavailable");
        } finally { watchdog.cancel(false); try { socket.close(); } catch (IOException ignored) { } }
    }

    static UpstreamResponse parseResponse(InputStream in) throws IOException {
        String statusLine = readLine(in, 8192);
        if (statusLine == null || !statusLine.matches("HTTP/1\\.[01] [0-9]{3}.*")) throw formatError("Invalid response");
        int status = Integer.parseInt(statusLine.substring(9, 12));
        java.util.Map<String, String> headers = new java.util.HashMap<>();
        int headerBytes = statusLine.length();
        for (;;) {
            String line = readLine(in, MAX_HEADER_BYTES);
            if (line == null) throw formatError("Incomplete response headers");
            headerBytes += line.length() + 2;
            if (headerBytes > MAX_HEADER_BYTES) throw formatError("Response headers too large");
            if (line.isEmpty()) break;
            int colon = line.indexOf(':');
            if (colon <= 0) throw formatError("Invalid response header");
            headers.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
        }
        if (isRedirect(status)) return new UpstreamResponse(status, headers.get("location"), null);
        if (status != 200) throw new TileException(502,"upstream_http","Upstream status unavailable");
        String transfer = headers.get("transfer-encoding");
        byte[] body;
        if (transfer != null && transfer.toLowerCase(Locale.ROOT).contains("chunked")) body = readChunked(in, MAX_BYTES);
        else {
            long declared = -1;
            try { if (headers.containsKey("content-length")) declared = Long.parseLong(headers.get("content-length")); }
            catch (NumberFormatException error) { throw formatError("Invalid content length"); }
            if (declared > MAX_BYTES || declared < -1) throw formatError("Tile too large");
            body = readLimited(in, MAX_BYTES);
            if (declared >= 0 && body.length != declared) throw formatError("Incomplete tile body");
        }
        String actualMime = imageMime(body);
        String declaredMime = headers.getOrDefault("content-type", "").split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        if (actualMime == null || !actualMime.equals(declaredMime)) throw formatError("Invalid tile image");
        return new UpstreamResponse(status,null,new Tile(body,actualMime));
    }

    private static TileException formatError(String message) { return new TileException(502,"format",message); }

    static boolean isRedirect(int status) { return status==301 || status==302 || status==303 || status==307 || status==308; }
    static String resolveRedirect(String current,String location) throws IOException {
        final URI base;
        final URI next;
        try { base = new URI(current); next = base.resolve(location); }
        catch (Exception error) { throw new IOException("Invalid tile redirect"); }
        if ("https".equalsIgnoreCase(base.getScheme()) && "http".equalsIgnoreCase(next.getScheme())) throw new IOException("Insecure tile redirect");
        validate(next.toASCIIString());
        return next.toASCIIString();
    }

    static Target validate(String raw) throws IOException {
        if (raw == null || raw.isEmpty() || raw.length() > MAX_URL_LENGTH || raw.matches(".*[\\x00-\\x20{}\\\\].*")) throw new IOException("Invalid tile URL");
        final URI uri;
        try { uri = new URI(raw); } catch (Exception error) { throw new IOException("Invalid tile URL"); }
        String scheme = uri.getScheme();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) throw new IOException("Unsupported tile URL");
        if (uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null) throw new IOException("Invalid tile host");
        String host = uri.getHost();
        if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length() - 1);
        if (host.endsWith(".") || host.indexOf('%') >= 0) throw new IOException("Invalid tile host");
        int port = uri.getPort() < 0 ? ("https".equalsIgnoreCase(scheme) ? 443 : 80) : uri.getPort();
        if (port != 80 && port != 443 && port != 8000 && port != 8080 && port != 8443 && port != 8880 && port != 8888 && port != 20262) throw new IOException("Unsupported tile port");
        return new Target(uri, host, port);
    }

    static boolean isPublicAddress(InetAddress address) {
        if (address instanceof Inet4Address) {
            byte[] b = address.getAddress(); int a=b[0]&255, c=b[1]&255, d=b[2]&255;
            if (a==0 || a==10 || a==127 || a>=224) return false;
            if (a==100 && c>=64 && c<=127) return false;
            if (a==169 && c==254) return false;
            if (a==172 && c>=16 && c<=31) return false;
            if (a==192 && (c==0 || c==168)) return false;
            if (a==192 && c==88 && d==99) return false;
            if (a==198 && (c==18 || c==19 || c==51 && d==100)) return false;
            if (a==203 && c==0 && d==113) return false;
            return true;
        }
        if (!(address instanceof Inet6Address)) return false;
        byte[] b=address.getAddress();
        if (isWellKnownNat64(b)) {
            try { return isPublicAddress(InetAddress.getByAddress(new byte[] {b[12],b[13],b[14],b[15]})); }
            catch (UnknownHostException impossible) { return false; }
        }
        if ((b[0]&0xe0)!=0x20) return false; // Only global unicast 2000::/3.
        boolean allZero=true; for(byte value:b) if(value!=0){allZero=false;break;}
        if (allZero || address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress() || address.isSiteLocalAddress() || address.isMulticastAddress()) return false;
        // Exclude IPv4 transition, documentation, and special-purpose 2001 ranges.
        // Conservatively exclude 2001 special-purpose and 2002 6to4 space, plus 3fff::/20 documentation.
        int firstWord=(b[0]&255)<<8 | (b[1]&255), secondWord=(b[2]&255)<<8 | (b[3]&255);
        if (firstWord==0x2001 && (secondWord<=0x03ff || secondWord==0x0db8 || (secondWord>=0x0020 && secondWord<=0x002f))) return false;
        if (firstWord==0x2002) return false;
        if (firstWord==0x3fff && (b[2]&0xf0)==0) return false;
        return true;
    }

    private static boolean isWellKnownNat64(byte[] b) {
        if ((b[0]&255)!=0 || (b[1]&255)!=0x64 || (b[2]&255)!=0xff || (b[3]&255)!=0x9b) return false;
        for(int i=4;i<12;i++) if(b[i]!=0) return false;
        return true;
    }

    static String imageMime(byte[] b) {
        if (b.length>=8 && (b[0]&255)==137 && b[1]=='P' && b[2]=='N' && b[3]=='G' && b[4]==13 && b[5]==10 && b[6]==26 && b[7]==10) return "image/png";
        if (b.length>=3 && (b[0]&255)==255 && (b[1]&255)==216 && (b[2]&255)==255) return "image/jpeg";
        if (b.length>=12 && ascii(b,0,4).equals("RIFF") && ascii(b,8,12).equals("WEBP")) return "image/webp";
        if (b.length>=6 && (ascii(b,0,6).equals("GIF87a") || ascii(b,0,6).equals("GIF89a"))) return "image/gif";
        if (b.length>=16 && ascii(b,4,8).equals("ftyp") && (ascii(b,8,12).equals("avif") || ascii(b,8,12).equals("avis"))) return "image/avif";
        return null;
    }
    private static String ascii(byte[] bytes,int start,int end) { return new String(bytes,start,end-start,StandardCharsets.US_ASCII); }
    private static String readLine(InputStream in,int max) throws IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream(); int previous=-1;
        while(out.size()<=max) { int value=in.read(); if(value<0) return out.size()==0?null:out.toString("US-ASCII"); if(previous==13 && value==10) { byte[] line=out.toByteArray(); return new String(line,0,Math.max(0,line.length-1),StandardCharsets.US_ASCII); } out.write(value); previous=value; }
        throw new IOException("Response line too long");
    }
    private static byte[] readLimited(InputStream in,int limit) throws IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream(); byte[] buffer=new byte[8192];
        for(int n;(n=in.read(buffer))!=-1;) { if(n>limit-out.size()) throw formatError("Tile too large"); out.write(buffer,0,n); }
        return out.toByteArray();
    }
    private static byte[] readChunked(InputStream in,int limit) throws IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        int trailerBytes=0;
        for(;;) {
            String line=readLine(in,128); if(line==null) throw formatError("Invalid chunk");
            int semi=line.indexOf(';'); String sizeText=semi<0?line:line.substring(0,semi);
            final int size; try { size=Integer.parseInt(sizeText.trim(),16); } catch(Exception error) { throw formatError("Invalid chunk"); }
            if(size<0 || size>limit-out.size()) throw formatError("Tile too large");
            if(size==0) { while(true) { String trailer=readLine(in,MAX_HEADER_BYTES); if(trailer==null) throw formatError("Invalid chunk trailer"); trailerBytes+=trailer.length()+2; if(trailerBytes>MAX_HEADER_BYTES) throw formatError("Chunk trailers too large"); if(trailer.isEmpty()) break; } return out.toByteArray(); }
            byte[] chunk=new byte[size]; int offset=0; while(offset<size) { int n=in.read(chunk,offset,size-offset); if(n<0) throw new IOException("Incomplete tile"); offset+=n; }
            out.write(chunk); if(in.read()!=13 || in.read()!=10) throw formatError("Invalid chunk ending");
        }
    }

    private static int remainingMs(long deadline) throws IOException {
        long remaining=deadline-System.nanoTime();
        if(remaining<=0) throw new IOException("Tile request timed out");
        return (int)Math.max(1,Math.min(TIMEOUT_MS,(remaining+999_999L)/1_000_000L));
    }
    private static final class DeadlineInputStream extends java.io.FilterInputStream {
        private final Socket socket;
        private final long deadline;
        DeadlineInputStream(InputStream input,Socket socket,long deadline) { super(input); this.socket=socket; this.deadline=deadline; }
        private void updateTimeout() throws IOException { socket.setSoTimeout(remainingMs(deadline)); }
        @Override public int read() throws IOException { updateTimeout(); return super.read(); }
        @Override public int read(byte[] bytes,int offset,int length) throws IOException { updateTimeout(); return super.read(bytes,offset,length); }
    }
    private MapTileProxy() { }
}
