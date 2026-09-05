package com.guanyun.weather;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Runs without Android; verifies real transport/parser code used in the APK. */
public final class DataTransportCheck {
    private static void check(boolean success, String label) { if (!success) throw new AssertionError(label); }
    public static void main(String[] args) throws Exception {
        check(DataTransport.validTile(12, 3219, 1676, 14), "Chengdu tile");
        check(!DataTransport.validTile(15, 0, 0, 14), "zoom bound");
        check(!DataTransport.validTile(5, 32, 0, 5), "column bound");
        check(!DataTransport.validTile(5, -1, 0, 5), "negative column");
        String id = "<ows:Identifier>VIIRS_SNPP_CorrectedReflectance_TrueColor</ows:Identifier>";
        String xml = "<Layer><Default>2020-01-01</Default></Layer><Layer>" + id + "<Default>2026-09-05</Default></Layer>";
        check("2026-09-05".equals(DataTransport.parseSatelliteDate(xml)), "date from requested satellite layer");
        try { DataTransport.parseSatelliteDate("<Layer>" + id + "</Layer><Default>2026-09-05</Default>"); throw new AssertionError("cross-layer date accepted"); } catch (IOException expected) { }
        try { DataTransport.readLimited(new ByteArrayInputStream(new byte[9]), 8); throw new AssertionError("body limit bypassed"); } catch (IOException expected) { }
        try { DataTransport.get("http://tiles.macrostrat.org/", 64); throw new AssertionError("cleartext accepted"); } catch (IOException expected) { }
        try { DataTransport.get("https://example.com/", 64); throw new AssertionError("arbitrary provider accepted"); } catch (IOException expected) { }
        System.out.println("Native transport checks passed: bounds, requested-layer date, size limit, HTTPS/provider allowlist");
        if (args.length > 0 && "--live".equals(args[0])) {
            byte[] terrain = DataTransport.get("https://elevation-tiles-prod.s3.amazonaws.com/terrarium/10/804/419.png", 4 * 1024 * 1024);
            check(terrain.length > 8 && (terrain[0] & 255) == 137 && terrain[1] == 80, "live terrain PNG");
            byte[] geology = DataTransport.get("https://tiles.macrostrat.org/carto/5/25/13.mvt", 4 * 1024 * 1024);
            check(geology.length > 100, "live geology vector tile");
            byte[] metadata = DataTransport.get("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml", 16 * 1024 * 1024);
            String date = DataTransport.parseSatelliteDate(new String(metadata, StandardCharsets.UTF_8));
            System.out.println("Live native HTTPS passed: terrain=" + terrain.length + ", geology=" + geology.length + ", VIIRS date=" + date);
        }
    }
}
