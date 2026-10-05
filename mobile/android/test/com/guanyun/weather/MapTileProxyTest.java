package com.guanyun.weather;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.InetAddress;
import java.net.URI;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

/** JVM checks for address filtering, redirect rules, and real HTTP response parsing. */
public final class MapTileProxyTest {
    private static void check(boolean condition, String label) {
        if (!condition) throw new AssertionError(label);
    }
    private static void rejects(String url) throws Exception {
        try { MapTileProxy.validate(url); throw new AssertionError("accepted invalid URL"); }
        catch (IOException expected) { }
    }
    private static void rejectsRedirect(String source,String location) throws Exception {
        try { MapTileProxy.resolveRedirect(source,location); throw new AssertionError("accepted invalid redirect"); }
        catch (IOException expected) { }
    }
    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int previous=-1;
        for (int value;(value=in.read())>=0;) {
            if (previous==13 && value==10) {
                byte[] bytes=line.toByteArray();
                return new String(bytes,0,bytes.length-1,StandardCharsets.US_ASCII);
            }
            line.write(value); previous=value;
        }
        return line.size()==0?null:line.toString("US-ASCII");
    }
    private static MapTileProxy.UpstreamResponse requestPinned(String rawUrl,InetAddress peer,long deadline) throws Exception {
        URI uri=new URI(rawUrl);
        Class<?> targetType=Class.forName("com.guanyun.weather.MapTileProxy$Target");
        Constructor<?> constructor=targetType.getDeclaredConstructor(URI.class,String.class,int.class);
        constructor.setAccessible(true);
        Object target=constructor.newInstance(uri,uri.getHost(),uri.getPort());
        Class<?> controlType=Class.forName("com.guanyun.weather.MapTileProxy$RequestControl");
        Method method=MapTileProxy.class.getDeclaredMethod("requestPinned",targetType,InetAddress.class,InetAddress[].class,long.class,controlType);
        method.setAccessible(true);
        try { return (MapTileProxy.UpstreamResponse)method.invoke(null,target,peer,new InetAddress[] {peer},deadline,null); }
        catch (java.lang.reflect.InvocationTargetException error) {
            Throwable cause=error.getCause();
            if (cause instanceof Exception) throw (Exception)cause;
            throw error;
        }
    }
    public static void main(String[] args) throws Exception {
        check(MapTileProxy.isPublicAddress(InetAddress.getByName("8.8.8.8")), "public IPv4");
        check(!MapTileProxy.isPublicAddress(InetAddress.getByName("127.0.0.1")), "loopback IPv4");
        check(!MapTileProxy.isPublicAddress(InetAddress.getByName("10.1.2.3")), "private IPv4");
        check(!MapTileProxy.isPublicAddress(InetAddress.getByName("169.254.1.1")), "link local IPv4");
        check(!MapTileProxy.isPublicAddress(InetAddress.getByName("100.64.0.1")), "carrier NAT IPv4");
        check(MapTileProxy.isPublicAddress(InetAddress.getByName("2606:4700:4700::1111")), "public IPv6");
        check(!MapTileProxy.isPublicAddress(InetAddress.getByName("fd00::1")), "private IPv6");
        check(!MapTileProxy.isPublicAddress(InetAddress.getByName("fe80::1")), "link local IPv6");
        check(!MapTileProxy.isPublicAddress(InetAddress.getByName("2002:0808:0808::1")), "6to4 IPv6");
        check(MapTileProxy.isPublicAddress(InetAddress.getByName("64:ff9b::808:808")), "NAT64 public IPv4");
        check(!MapTileProxy.isPublicAddress(InetAddress.getByName("64:ff9b::a00:1")), "NAT64 private IPv4");
        check(!MapTileProxy.isPublicAddress(InetAddress.getByName("64:ff9a::808:808")), "reject alternate NAT64 prefix");
        check(!MapTileProxy.isPublicAddress(InetAddress.getByName("64:ff9b:1::808:808")), "reject nonstandard NAT64 prefix");
        for (InetAddress[] mixed : new InetAddress[][] {
            {InetAddress.getByName("8.8.8.8"),InetAddress.getByName("127.0.0.1")},
            {InetAddress.getByName("127.0.0.1"),InetAddress.getByName("8.8.8.8")}
        }) {
            try { MapTileProxy.requirePublicAddresses(mixed); throw new AssertionError("mixed public/private DNS answer accepted"); }
            catch (MapTileProxy.TileException expected) { check("blocked".equals(expected.diagnostic),"private DNS answer diagnostic"); }
        }
        check("connect".equals(MapTileProxy.classifyAttemptFailure(new java.net.ConnectException(),System.nanoTime()+1_000_000_000L).diagnostic),"connect diagnostic category");
        check("tls".equals(MapTileProxy.classifyAttemptFailure(new javax.net.ssl.SSLException("fixture"),System.nanoTime()+1_000_000_000L).diagnostic),"TLS diagnostic category");
        check("timeout".equals(MapTileProxy.classifyAttemptFailure(new IOException(),System.nanoTime()-1).diagnostic),"timeout diagnostic category");
        check("upstream_http".equals(MapTileProxy.classifyAttemptFailure(new IOException(),System.nanoTime()+1_000_000_000L).diagnostic),"upstream diagnostic category");
        final int[] attempts={0};
        InetAddress first=InetAddress.getByName("8.8.8.8"), second=InetAddress.getByName("1.1.1.1");
        final long overallDeadline=System.nanoTime()+MapTileProxy.TIMEOUT_MS*1_000_000L;
        MapTileProxy.UpstreamResponse fallback=MapTileProxy.tryAddresses(new InetAddress[] {first,second},overallDeadline,(address,attemptDeadline)->{
            attempts[0]++;
            check(attemptDeadline<=overallDeadline,"attempt deadline bounded");
            if(address.equals(first)) throw new IOException("simulated unreachable first address");
            return new MapTileProxy.UpstreamResponse(200,null,new MapTileProxy.Tile(new byte[] {1},"image/png"));
        });
        check(attempts[0]==2 && fallback.status==200,"fallback to next validated IP");
        final boolean[] attemptedMixed={false};
        try {
            MapTileProxy.tryAddresses(new InetAddress[] {first,InetAddress.getByName("127.0.0.1")},System.nanoTime()+MapTileProxy.TIMEOUT_MS*1_000_000L,(address,attemptDeadline)->{
                attemptedMixed[0]=true; return new MapTileProxy.UpstreamResponse(200,null,null);
            });
            throw new AssertionError("mixed address set accepted");
        } catch(MapTileProxy.TileException expected) { }
        check(!attemptedMixed[0],"private address blocks fallback before any socket attempt");
        check("image/png".equals(MapTileProxy.imageMime(new byte[] {(byte)137,80,78,71,13,10,26,10})), "PNG signature");
        check("image/jpeg".equals(MapTileProxy.imageMime(new byte[] {(byte)255,(byte)216,(byte)255})), "JPEG signature");
        check(MapTileProxy.imageMime("not an image".getBytes(StandardCharsets.US_ASCII)) == null, "reject non-image");
        MapTileProxy.validate("https://tiles.example.org/1/2/3.png");
        MapTileProxy.validate("http://tiles.example.org:8080/1/2/3.png");
        rejects("file:///etc/passwd");
        rejects("https://user:pass@tiles.example.org/a");
        rejects("https://tiles.example.org:22/a");
        rejects("https://tiles.example.org/a\\b");

        check(MapTileProxy.isRedirect(301) && MapTileProxy.isRedirect(302) && MapTileProxy.isRedirect(303) && MapTileProxy.isRedirect(307) && MapTileProxy.isRedirect(308), "allowed redirect statuses");
        check(!MapTileProxy.isRedirect(300) && !MapTileProxy.isRedirect(304) && !MapTileProxy.isRedirect(305), "reject other 3xx statuses");
        check(MapTileProxy.resolveRedirect("https://tiles.example.org/a/b?key=private", "../c.png?next=1").equals("https://tiles.example.org/c.png?next=1"), "relative redirect resolution");
        check(MapTileProxy.resolveRedirect("http://tiles.example.org/a", "https://cdn.example.org/b").startsWith("https://cdn.example.org/"), "HTTP to HTTPS redirect");
        rejectsRedirect("https://tiles.example.org/a", "http://tiles.example.org/b");
        rejectsRedirect("https://tiles.example.org/a", "file:///private/data");

        String redirect = "HTTP/1.1 302 Found\r\nLocation: ../tile.png?sig=hidden\r\nContent-Length: 0\r\n\r\n";
        MapTileProxy.UpstreamResponse redirected = MapTileProxy.parseResponse(new ByteArrayInputStream(redirect.getBytes(StandardCharsets.US_ASCII)));
        check(redirected.status==302 && "../tile.png?sig=hidden".equals(redirected.location) && redirected.tile==null, "redirect response parsing");

        ByteArrayOutputStream chunked = new ByteArrayOutputStream();
        chunked.write("HTTP/1.1 200 OK\r\nContent-Type: image/png; charset=binary\r\nTransfer-Encoding: chunked\r\n\r\n8\r\n".getBytes(StandardCharsets.US_ASCII));
        chunked.write(new byte[] {(byte)137,80,78,71,13,10,26,10});
        chunked.write("\r\n0\r\nX-Trace: ignored\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
        MapTileProxy.UpstreamResponse image = MapTileProxy.parseResponse(new ByteArrayInputStream(chunked.toByteArray()));
        check(image.status==200 && image.tile!=null && image.tile.bytes.length==8 && "image/png".equals(image.tile.mime), "chunked PNG response parsing");

        byte[] png={(byte)137,80,78,71,13,10,26,10};
        check(MapTileProxy.isCompatibleImageMime("image/png",""),"missing MIME accepted from image signature");
        check(MapTileProxy.isCompatibleImageMime("image/png","application/octet-stream"),"generic MIME accepted from image signature");
        check(MapTileProxy.isCompatibleImageMime("image/jpeg","image/jpg"),"image/jpg alias accepted");
        check(!MapTileProxy.isCompatibleImageMime(null,"application/octet-stream"),"generic MIME cannot validate arbitrary bytes");
        check(!MapTileProxy.isCompatibleImageMime("image/png","text/html"),"HTML content type rejected");
        for (String mime : new String[] {"", "application/octet-stream"}) {
            ByteArrayOutputStream response=new ByteArrayOutputStream();
            String type=mime.isEmpty()?"":"Content-Type: "+mime+"\r\n";
            response.write(("HTTP/1.1 200 OK\r\n"+type+"Content-Length: 8\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            response.write(png);
            check(MapTileProxy.parseResponse(new ByteArrayInputStream(response.toByteArray())).tile!=null,"real response MIME compatibility: "+mime);
        }
        ByteArrayOutputStream jpgResponse=new ByteArrayOutputStream();
        byte[] jpeg={(byte)255,(byte)216,(byte)255};
        jpgResponse.write("HTTP/1.1 200 OK\r\nContent-Type: image/jpg\r\nContent-Length: 3\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
        jpgResponse.write(jpeg);
        check("image/jpeg".equals(MapTileProxy.parseResponse(new ByteArrayInputStream(jpgResponse.toByteArray())).tile.mime),"image/jpg response canonicalized");
        String html="<html>not a tile</html>";
        String htmlResponse="HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: "+html.length()+"\r\n\r\n"+html;
        try { MapTileProxy.parseResponse(new ByteArrayInputStream(htmlResponse.getBytes(StandardCharsets.US_ASCII))); throw new AssertionError("accepted HTML as a tile"); }
        catch (MapTileProxy.TileException expected) { check("format".equals(expected.diagnostic),"HTML rejected after content sniff"); }
        String http10="HTTP/1.0 200 OK\r\nContent-Type: image/png\r\nContent-Length: 8\r\n\r\n"+new String(png,StandardCharsets.ISO_8859_1);
        check(!MapTileProxy.parseResponse(new ByteArrayInputStream(http10.getBytes(StandardCharsets.ISO_8859_1))).reusable,"HTTP/1.0 is not persistent by default");
        check(MapTileProxy.parseResponse(new ByteArrayInputStream(("HTTP/1.0 200 OK\r\nContent-Type: image/png\r\nContent-Length: 8\r\nConnection: keep-alive\r\n\r\n"+new String(png,StandardCharsets.ISO_8859_1)).getBytes(StandardCharsets.ISO_8859_1))).reusable,"HTTP/1.0 explicit keep-alive accepted");
        try { MapTileProxy.parseResponse(new ByteArrayInputStream(("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 8\r\nTransfer-Encoding: chunked\r\n\r\n").getBytes(StandardCharsets.US_ASCII))); throw new AssertionError("accepted ambiguous body framing"); }
        catch (MapTileProxy.TileException expected) { check("format".equals(expected.diagnostic),"Transfer-Encoding plus Content-Length rejected"); }

        ByteArrayOutputStream brokenChunk = new ByteArrayOutputStream();
        brokenChunk.write("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nTransfer-Encoding: chunked\r\n\r\n8\r\n".getBytes(StandardCharsets.US_ASCII));
        brokenChunk.write(new byte[] {(byte)137,80,78,71,13,10,26,10});
        brokenChunk.write("\r\n0\r\nX\n\r\n".getBytes(StandardCharsets.US_ASCII));
        try { MapTileProxy.parseResponse(new ByteArrayInputStream(brokenChunk.toByteArray())); throw new AssertionError("accepted bad chunk"); }
        catch (MapTileProxy.TileException expected) { check("format".equals(expected.diagnostic),"bad chunk diagnostic category"); }
        String httpError="HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n";
        try { MapTileProxy.parseResponse(new ByteArrayInputStream(httpError.getBytes(StandardCharsets.US_ASCII))); throw new AssertionError("accepted HTTP error"); }
        catch (MapTileProxy.TileException expected) { check("upstream_http".equals(expected.diagnostic),"HTTP status diagnostic category"); }

        InetAddress loopback=InetAddress.getByName("127.0.0.1");
        ServerSocket keepAliveServer=new ServerSocket(0,2,loopback);
        int[] acceptedSockets={0}, servedRequests={0};
        AtomicReference<Throwable> fixtureError=new AtomicReference<>();
        Thread keepAliveThread=new Thread(() -> {
            try (ServerSocket server=keepAliveServer; Socket client=server.accept()) {
                acceptedSockets[0]++;
                for (int i=0;i<2;i++) {
                    if (readLine(client.getInputStream())==null) throw new IOException("missing keep-alive request");
                    String line;
                    do { line=readLine(client.getInputStream()); } while (line!=null && !line.isEmpty());
                    client.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 8\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                    client.getOutputStream().write(png); client.getOutputStream().flush(); servedRequests[0]++;
                }
            } catch (Throwable error) { fixtureError.set(error); }
        },"map-tile-keepalive-test");
        keepAliveThread.setDaemon(true); keepAliveThread.start();
        String keepAliveUrl="http://127.0.0.1:"+keepAliveServer.getLocalPort()+"/tile";
        check(requestPinned(keepAliveUrl,loopback,System.nanoTime()+2_000_000_000L).tile!=null,"first native pooled request succeeds");
        check(requestPinned(keepAliveUrl,loopback,System.nanoTime()+2_000_000_000L).tile!=null,"second native pooled request succeeds");
        keepAliveThread.join(2000);
        check(fixtureError.get()==null,"keep-alive fixture server completes");
        check(acceptedSockets[0]==1 && servedRequests[0]==2,"two HTTP requests share one TCP connection");

        ServerSocket staleServer=new ServerSocket(0,2,loopback);
        int[] staleSockets={0};
        Thread staleThread=new Thread(() -> {
            try (ServerSocket server=staleServer) {
                for (int i=0;i<2;i++) try (Socket client=server.accept()) {
                    staleSockets[0]++;
                    if (readLine(client.getInputStream())==null) throw new IOException("missing stale fixture request");
                    String line;
                    do { line=readLine(client.getInputStream()); } while (line!=null && !line.isEmpty());
                    client.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 8\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                    client.getOutputStream().write(png); client.getOutputStream().flush();
                }
            } catch (Throwable error) { fixtureError.set(error); }
        },"map-tile-stale-connection-test");
        staleThread.setDaemon(true); staleThread.start();
        String staleUrl="http://127.0.0.1:"+staleServer.getLocalPort()+"/tile";
        check(requestPinned(staleUrl,loopback,System.nanoTime()+2_000_000_000L).tile!=null,"request seeds server-closed idle socket");
        check(requestPinned(staleUrl,loopback,System.nanoTime()+2_000_000_000L).tile!=null,"closed idle socket retries on a fresh connection");
        staleThread.join(2000);
        check(fixtureError.get()==null && staleSockets[0]==2,"stale connection used one recovery socket");

        ServerSocket slowServer=new ServerSocket(0,1,loopback);
        Thread slowThread=new Thread(() -> {
            try (ServerSocket server=slowServer; Socket client=server.accept()) {
                readLine(client.getInputStream()); String line;
                do { line=readLine(client.getInputStream()); } while (line!=null && !line.isEmpty());
                Thread.sleep(400);
            } catch (Exception ignored) { }
        },"map-tile-timeout-release-test");
        slowThread.setDaemon(true); slowThread.start();
        try { requestPinned("http://127.0.0.1:"+slowServer.getLocalPort()+"/slow",loopback,System.nanoTime()+150_000_000L); throw new AssertionError("slow tile exceeded deadline"); }
        catch (MapTileProxy.TileException expected) { check("timeout".equals(expected.diagnostic),"tile deadline closes slow response"); }
        Field activeField=MapTileProxy.class.getDeclaredField("activeRequests"); activeField.setAccessible(true);
        check(activeField.getInt(null)==0,"timeout releases global and per-host capacity");
        slowThread.join(1000);
        System.out.println("MapTileProxyTest PASS");
    }
}
