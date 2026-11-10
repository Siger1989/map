package com.guanyun.weather;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

/** In-memory, privacy-safe progress for the most recent GPS photo import. */
final class PhotoImportStatus {
    private static final int MAX_ENTRIES = 200;
    private static final int MAX_ENTRY_CHARS = 512;
    private static final int MAX_MESSAGE_CHARS = 1800;
    private long id;
    private String status = "idle";
    private String message = "";
    private int selected;
    private int prepared;
    private final ArrayList<String> notes = new ArrayList<>();
    private final ArrayList<String> failures = new ArrayList<>();

    synchronized long begin(String message) {
        id++;
        status = "selecting";
        this.message = bounded(message, MAX_MESSAGE_CHARS);
        selected = prepared = 0;
        notes.clear();
        failures.clear();
        return id;
    }

    synchronized long currentId() { return id; }

    synchronized boolean update(long batchId, String nextStatus, String message, int selected, int prepared,
                                List<String> notes, List<String> failures) {
        if (batchId != id || !validStatus(nextStatus) || isTerminal(status)) return false;
        status = nextStatus;
        this.message = bounded(message, MAX_MESSAGE_CHARS);
        this.selected = clamp(selected, 0, MAX_ENTRIES);
        this.prepared = clamp(prepared, 0, this.selected);
        this.notes.clear();
        this.failures.clear();
        int remaining = MAX_ENTRIES;
        if (notes != null) for (String note : notes) {
            if (remaining-- <= 0) break;
            this.notes.add(bounded(note, MAX_ENTRY_CHARS));
        }
        remaining = Math.max(0, MAX_ENTRIES - this.notes.size());
        if (failures != null) for (String failure : failures) {
            if (remaining-- <= 0) break;
            this.failures.add(bounded(failure, MAX_ENTRY_CHARS));
        }
        return true;
    }

    synchronized String json() {
        try {
            JSONArray noteArray = new JSONArray();
            for (String note : notes) noteArray.put(note);
            JSONArray failureArray = new JSONArray();
            for (String failure : failures) failureArray.put(failure);
            return new JSONObject().put("id", id).put("status", status).put("message", message)
                .put("selected", selected).put("prepared", prepared).put("notes", noteArray)
                .put("failures", failureArray).toString();
        } catch (Exception impossible) { return "{}"; }
    }

    private static String bounded(String value, int max) {
        if (value == null) return "";
        return value.length() <= max ? value : value.substring(0, max);
    }
    private static int clamp(int value, int min, int max) { return Math.max(min, Math.min(max, value)); }
    private static boolean isTerminal(String value) {
        return "complete".equals(value) || "cancelled".equals(value) || "failed".equals(value);
    }
    private static boolean validStatus(String value) {
        return "idle".equals(value) || "selecting".equals(value) || "preparing".equals(value)
            || "complete".equals(value) || "cancelled".equals(value) || "failed".equals(value);
    }
}
