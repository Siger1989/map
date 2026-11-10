package com.guanyun.weather

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30], manifest = Config.NONE)
class PhotoImportStatusTest {
    @Test fun exposesFullPrivacySafeBatchAndRejectsStaleCompletion() {
        val state = PhotoImportStatus()
        val first = state.begin("正在选择照片。")
        assertTrue(state.update(first, "preparing", "正在读取所选照片。", 2, 0, null, null))

        val second = state.begin("正在选择照片。")
        assertEquals(first + 1, second)
        assertFalse(state.update(first, "complete", "旧批次", 2, 2, null, null))

        val notes = (1..12).map { "照片$it：已通过所选文件读取。" }
        val failures = (1..9).map { "照片$it：照片处理失败" }
        assertTrue(state.update(second, "complete", "所选照片读取完成。", 21, 12, notes, failures))

        val json = JSONObject(state.json())
        assertEquals(setOf("id", "status", "message", "selected", "prepared", "notes", "failures"), json.keys().asSequence().toSet())
        assertEquals(second, json.getLong("id"))
        assertEquals("complete", json.getString("status"))
        assertEquals(21, json.getInt("selected"))
        assertEquals(12, json.getInt("prepared"))
        assertEquals(12, json.getJSONArray("notes").length())
        assertEquals(9, json.getJSONArray("failures").length())
        val serialized = json.toString()
        assertFalse(serialized.contains("content://"))
        assertFalse(serialized.contains("latitude"))
        assertFalse(serialized.contains("longitude"))
    }

    @Test fun supportsPermissionRefusalAndEmptyFailureAsReadableTerminalStates() {
        val state = PhotoImportStatus()
        val id = state.begin("正在选择照片。")
        assertTrue(state.update(id, "failed", "未授予照片位置读取权限，本次未开始选择。", 0, 0, null, null))
        var json = JSONObject(state.json())
        assertEquals("failed", json.getString("status"))
        assertTrue(json.getString("message").contains("未授予"))
        assertFalse(state.update(id, "preparing", "迟到工作线程", 3, 0, null, null))

        val nextId = state.begin("重新选择照片。")
        assertTrue(state.update(nextId, "cancelled", "已取消照片选择。", 0, 0, null, null))
        json = JSONObject(state.json())
        assertEquals("cancelled", json.getString("status"))
        assertFalse(state.update(nextId, "preparing", "关闭后的异步扫描", 1, 0, null, null))
    }

    @Test fun clampsStatusPayloadToParserLimits() {
        val state = PhotoImportStatus()
        val id = state.begin("x".repeat(4000))
        assertTrue(state.update(id, "complete", "m".repeat(4000), 999, 999,
            (1..260).map { "n".repeat(900) }, (1..260).map { "f".repeat(900) }))
        val json = JSONObject(state.json())
        assertTrue(json.getString("message").length <= 1800)
        assertEquals(200, json.getInt("selected"))
        assertEquals(200, json.getInt("prepared"))
        assertTrue(json.getJSONArray("notes").length() + json.getJSONArray("failures").length() <= 200)
        for (key in listOf("notes", "failures")) {
            val rows = json.getJSONArray(key)
            for (i in 0 until rows.length()) assertTrue(rows.getString(i).length <= 512)
        }
        assertTrue(state.json().length < 256 * 1024)
    }
}
