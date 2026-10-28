package com.shantu.nativeapp.photos

import android.content.ContentResolver
import android.net.Uri
import android.provider.DocumentsContract as Documents

object NativePhotoFolder {
    /** Read-only SAF traversal, bounded independently of image decoding. No filesystem paths. */
    fun list(resolver:ContentResolver,tree:Uri):List<Uri>{
        require(tree.scheme=="content"&&Documents.isTreeUri(tree)){"请选择照片文件夹"}
        val pending=java.util.ArrayDeque<Pair<String,Int>>();pending.add(Documents.getTreeDocumentId(tree) to 0)
        val seen=hashSetOf<String>();val result=mutableListOf<Uri>();var entries=0
        while(pending.isNotEmpty()){
            val(id,depth)=pending.removeFirst();if(!seen.add(id))continue
            require(depth<=16){"目录层级超过16层，请选择更具体目录"}
            val children=Documents.buildChildDocumentsUriUsingTree(tree,id)
            resolver.query(children,arrayOf(Documents.Document.COLUMN_DOCUMENT_ID,Documents.Document.COLUMN_MIME_TYPE),null,null,null)?.use{cursor->while(cursor.moveToNext()){
                require(++entries<=10000){"目录条目超过10000，请选择更小目录"}
                val child=cursor.getString(0);val mime=cursor.getString(1).orEmpty()
                if(mime==Documents.Document.MIME_TYPE_DIR)pending.add(child to depth+1)
                else if(mime.startsWith("image/")){require(result.size<500){"单次最多500张照片，请分批导入"};result+=Documents.buildDocumentUriUsingTree(tree,child)}
            }}
        }
        return result
    }
}
