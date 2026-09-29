package com.guanyun.weather;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;

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

        ByteArrayOutputStream brokenChunk = new ByteArrayOutputStream();
        brokenChunk.write("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nTransfer-Encoding: chunked\r\n\r\n8\r\n".getBytes(StandardCharsets.US_ASCII));
        brokenChunk.write(new byte[] {(byte)137,80,78,71,13,10,26,10});
        brokenChunk.write("\r\n0\r\nX\n\r\n".getBytes(StandardCharsets.US_ASCII));
        try { MapTileProxy.parseResponse(new ByteArrayInputStream(brokenChunk.toByteArray())); throw new AssertionError("accepted bad chunk"); }
        catch (IOException expected) { }
        System.out.println("MapTileProxyTest PASS");
    }
}
