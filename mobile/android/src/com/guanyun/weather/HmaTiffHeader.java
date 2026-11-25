package com.guanyun.weather;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.HashMap;
import java.util.Map;

/** Reads the first classic TIFF IFD of an HMA mosaic, using only a bounded prefix. */
final class HmaTiffHeader {
    static final int HEADER_BYTES = 65536;
    private static final int SHORT = 3, LONG = 4, DOUBLE = 12;
    private final ByteBuffer bytes;
    private final Map<Integer, Integer> entries = new HashMap<>();

    private HmaTiffHeader(byte[] data) throws IOException {
        require(data.length >= 8 && data.length <= HEADER_BYTES);
        bytes = ByteBuffer.wrap(data);
        require(data[0] == data[1] && (data[0] == 'I' || data[0] == 'M'));
        bytes.order(data[0] == 'I' ? ByteOrder.LITTLE_ENDIAN : ByteOrder.BIG_ENDIAN);
        require(u16(2) == 42);
        int directory = bounded(u32(4), 2);
        require(directory >= 8);
        int count = u16(directory);
        bounded(directory + 2, 12L * count + 4);
        for (int i = 0; i < count; i++) {
            int entry = directory + 2 + 12 * i;
            require(entries.put(u16(entry), entry) == null);
        }
    }

    static Map<String, Double> readGeoKeys(byte[] data) throws IOException {
        HmaTiffHeader file = new HmaTiffHeader(data);
        return file.metadata();
    }

    private Map<String, Double> metadata() throws IOException {
        require(!entries.containsKey(34264)); // Affine transforms need separate handling.
        int keys = tagOffset(34735, SHORT);
        long words = tagCount(34735);
        require(words >= 4 && u16(keys) == 1 && u16(keys + 2) == 1 && u16(keys + 4) <= 1);
        int count = u16(keys + 6);
        require(4L + 4L * count <= words);
        Map<String, Double> result = new HashMap<>();
        for (int i = 0; i < count; i++) {
            int key = keys + 8 + 8 * i;
            String name = keyName(u16(key));
            if (name == null) continue;
            int location = u16(key + 2), offset = u16(key + 6);
            require(u16(key + 4) == 1);
            double value;
            if (location == 0) {
                value = offset;
            } else if (location == 34736) {
                require(offset < tagCount(location));
                value = bytes.getDouble(tagOffset(location, DOUBLE) + 8 * offset);
            } else {
                throw new IOException("Invalid HMA GeoKey location");
            }
            require(Double.isFinite(value) && result.put(name, value) == null);
        }

        require(Double.valueOf(1).equals(result.get("GTModelTypeGeoKey")));
        require(Double.valueOf(1).equals(result.get("GTRasterTypeGeoKey")));
        require(!entries.containsKey(277) || scalar(277) == 1);
        double width = scalar(256), height = scalar(257);
        require(width > 0 && height > 0);
        require(tagCount(33550) == 3 && tagCount(33922) == 6);
        int scale = tagOffset(33550, DOUBLE), tie = tagOffset(33922, DOUBLE);
        double dx = bytes.getDouble(scale), dy = -bytes.getDouble(scale + 8);
        require(Double.isFinite(dx) && Double.isFinite(dy) && dx > 0 && dy < 0);
        double x = bytes.getDouble(tie + 24) - bytes.getDouble(tie) * dx;
        double y = bytes.getDouble(tie + 32) - bytes.getDouble(tie + 8) * dy;
        require(Double.isFinite(x) && Double.isFinite(y));
        result.put("width", width);
        result.put("height", height);
        result.put("originX", x);
        result.put("originY", y);
        result.put("pixelWidth", dx);
        result.put("pixelHeight", dy);
        return result;
    }

    private long scalar(int tag) throws IOException {
        require(tagCount(tag) == 1);
        int type = u16(entries.get(tag) + 2);
        require(type == SHORT || type == LONG);
        int value = tagOffset(tag, type);
        return type == SHORT ? u16(value) : u32(value);
    }

    private long tagCount(int tag) throws IOException {
        Integer entry = entries.get(tag);
        require(entry != null);
        return u32(entry + 4);
    }

    private int tagOffset(int tag, int type) throws IOException {
        long count = tagCount(tag);
        int entry = entries.get(tag);
        require(count > 0 && u16(entry + 2) == type);
        long size = count * (type == DOUBLE ? 8 : type == LONG ? 4 : 2);
        return bounded(size <= 4 ? entry + 8 : u32(entry + 8), size);
    }

    private int bounded(long offset, long size) throws IOException {
        require(offset >= 0 && offset + size <= bytes.limit());
        return (int)offset;
    }

    private int u16(int offset) { return Short.toUnsignedInt(bytes.getShort(offset)); }
    private long u32(int offset) { return Integer.toUnsignedLong(bytes.getInt(offset)); }

    private static void require(boolean condition) throws IOException {
        if (!condition) throw new IOException("Unsupported or incomplete HMA TIFF header");
    }

    private static String keyName(int key) {
        switch (key) {
            case 1024: return "GTModelTypeGeoKey";
            case 1025: return "GTRasterTypeGeoKey";
            case 2048: return "GeographicTypeGeoKey";
            case 3072: return "ProjectedCSTypeGeoKey";
            case 3075: return "ProjCoordTransGeoKey";
            case 3076: return "ProjLinearUnitsGeoKey";
            case 3078: return "ProjStdParallel1GeoKey";
            case 3079: return "ProjStdParallel2GeoKey";
            case 3080: return "ProjNatOriginLongGeoKey";
            case 3081: return "ProjNatOriginLatGeoKey";
            case 3082: return "ProjFalseEastingGeoKey";
            case 3083: return "ProjFalseNorthingGeoKey";
            default: return null;
        }
    }
}
