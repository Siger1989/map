package com.shantu.nativeapp.data

import android.content.Intent
import android.net.Uri
import android.os.Build

/** External documents are offered for explicit import; receiving an intent never writes a workspace. */
internal object NativeIncomingDocument {
    fun uri(intent:Intent?):Uri? {
        if(intent==null)return null
        val selected=when(intent.action) {
            Intent.ACTION_VIEW->intent.data
            Intent.ACTION_SEND->if(Build.VERSION.SDK_INT>=33)intent.getParcelableExtra(Intent.EXTRA_STREAM,Uri::class.java)
                else @Suppress("DEPRECATION") (intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
            else->null
        } ?: intent.clipData?.takeIf {intent.action in listOf(Intent.ACTION_VIEW,Intent.ACTION_SEND) && it.itemCount==1}?.getItemAt(0)?.uri
        return selected?.takeIf {it.scheme=="content" && it.authority?.isNotBlank()==true}
    }
}
