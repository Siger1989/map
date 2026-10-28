package com.shantu.nativeapp.cad

import java.io.File

/** GNU LibreDWG native decoder, no browser/JavaScript engine. Original bytes are kept. */
object NativeDwgDecoder {
    private val loaded by lazy { System.loadLibrary("shantu_cad"); true }
    private external fun convertNative(input:String,output:String):Int
    @Synchronized fun decode(name:String,bytes:ByteArray,tempDirectory:File):NativeDxfDecoded {
        require(bytes.size in 6..NativeDxfImporter.MAX_INPUT_BYTES && String(bytes,0,6,Charsets.US_ASCII).matches(Regex("AC[0-9]{4}"))){"DWG文件头无效"}
        check(loaded)
        tempDirectory.mkdirs()
        val input=File.createTempFile("drawing-",".dwg",tempDirectory)
        val output=File(input.parentFile,input.name+".dxf")
        try {
            input.writeBytes(bytes)
            require(convertNative(input.absolutePath,output.absolutePath)==0){"DWG解码失败或图元/输出超过上限；原文件保留"}
            val decoded=NativeDxfImporter.decode(name.substringBeforeLast('.')+".dxf",output.inputStream().use(NativeDxfImporter::readBounded))
            return decoded.copy(name=name,sourceBytes=bytes.copyOf())
        }finally{input.delete();output.delete()}
    }
}
