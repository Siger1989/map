package com.shantu.nativeapp.data

import android.content.Intent
import android.net.Uri
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35])
class NativeIncomingDocumentTest {
    @Test fun acceptsReadGrantedViewAndSharedDocumentUris() {
        val uri=Uri.parse("content://documents.example/routes/1")
        assertEquals(uri,NativeIncomingDocument.uri(Intent(Intent.ACTION_VIEW,uri)))
        assertEquals(uri,NativeIncomingDocument.uri(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM,uri)))
    }
    @Test fun rejectsLauncherAndPrivateFileOrNetworkSchemes() {
        assertNull(NativeIncomingDocument.uri(Intent(Intent.ACTION_MAIN,Uri.parse("content://documents.example/1"))))
        assertNull(NativeIncomingDocument.uri(Intent(Intent.ACTION_VIEW,Uri.parse("file:///data/data/com.shantu.nativeapp/files/workspace-v2.json"))))
        assertNull(NativeIncomingDocument.uri(Intent(Intent.ACTION_VIEW,Uri.parse("https://example.com/route.gpx"))))
    }
}
