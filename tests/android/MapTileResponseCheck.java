package com.guanyun.weather;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

public final class MapTileResponseCheck {
    private static final byte[] JPEG = {(byte)255, (byte)216, (byte)255, 12};
    private static byte[] response(String headers, byte[] body) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        out.write(("HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\n" + headers + "\r\n").getBytes(StandardCharsets.US_ASCII));
        out.write(body);
        return out.toByteArray();
    }
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    private static void rejects(String length, byte[] body) throws IOException {
        try {
            MapTileProxy.parseResponse(new ByteArrayInputStream(response("Content-Length: " + length + "\r\n", body)));
            throw new AssertionError("Invalid length accepted: " + length);
        } catch (MapTileProxy.TileException error) {
            require("format".equals(error.diagnostic), "Wrong length diagnostic");
        }
    }
    public static void main(String[] args) throws Exception {
        byte[] persistent = response("Content-Length: 4\r\nConnection: keep-alive\r\n", JPEG);
        ByteArrayInputStream openStream = new ByteArrayInputStream(persistent) {
            @Override public synchronized int read(byte[] bytes, int offset, int length) {
                if (available() == 0) throw new AssertionError("Read beyond complete body would wait for connection close");
                return super.read(bytes, offset, Math.min(length, 2));
            }
            @Override public synchronized int read() {
                if (available() == 0) throw new AssertionError("Read beyond complete body");
                return super.read();
            }
        };
        require(Arrays.equals(MapTileProxy.parseResponse(openStream).tile.bytes, JPEG), "Persistent response body changed");
        byte[] trailing = response("Content-Length: 4\r\n", new byte[] {(byte)255, (byte)216, (byte)255, 12, 99});
        ByteArrayInputStream stream = new ByteArrayInputStream(trailing);
        require(Arrays.equals(MapTileProxy.parseResponse(stream).tile.bytes, JPEG), "Trailing data included");
        require(stream.read() == 99, "Consumed bytes beyond Content-Length");
        rejects("5", JPEG);
        rejects("8388609", JPEG);
        rejects("-1", JPEG);
        rejects("+4", JPEG);
        rejects("oops", JPEG);
        require(Arrays.equals(MapTileProxy.parseResponse(new ByteArrayInputStream(response("", JPEG))).tile.bytes, JPEG), "EOF fallback broken");
        java.io.ByteArrayOutputStream chunked = new java.io.ByteArrayOutputStream();
        chunked.write("4\r\n".getBytes(StandardCharsets.US_ASCII)); chunked.write(JPEG);
        chunked.write("\r\n0\r\nX-Test: trailer\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
        require(Arrays.equals(MapTileProxy.parseResponse(new ByteArrayInputStream(response("Transfer-Encoding: chunked\r\n", chunked.toByteArray()))).tile.bytes, JPEG), "Chunked fallback broken");
        try {
            MapTileProxy.parseResponse(new ByteArrayInputStream(response("Content-Length: 4\r\n", new byte[4])));
            throw new AssertionError("Invalid image accepted");
        } catch (MapTileProxy.TileException error) { require("format".equals(error.diagnostic), "Image diagnostic changed"); }
        System.out.println("PASS native tile framing: persistent / partial / trailing / invalid / EOF / chunked / image");
    }
}
