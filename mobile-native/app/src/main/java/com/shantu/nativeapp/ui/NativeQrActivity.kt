package com.shantu.nativeapp.ui

import android.app.Activity
import android.os.Bundle
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.widget.LinearLayout
import android.widget.TextView
import com.journeyapps.barcodescanner.BarcodeView
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.DefaultDecoderFactory
import com.google.zxing.*
import com.google.zxing.common.HybridBinarizer
import java.util.concurrent.Executors

/** Native camera and image QR decoding. Decoded private source text is never displayed or logged. */
class NativeQrActivity:Activity() {
    private lateinit var camera:BarcodeView
    private lateinit var status:TextView
    private val executor=Executors.newSingleThreadExecutor()
    private var finished=false
    private var torch=false
    override fun onCreate(state:Bundle?) {
        super.onCreate(state)
        val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setBackgroundColor(ShantuColors.surface) }
        fun button(label:String,click:()->Unit)=TextView(this).apply {
            text=label;textSize=16f;setTextColor(ShantuColors.ink);gravity=android.view.Gravity.CENTER
            minHeight=(48*resources.displayMetrics.density).toInt();setOnClickListener {click()}
        }
        root.addView(button("‹ 返回   扫描路线 / 图源二维码") { finish() })
        camera=BarcodeView(this).apply {
            decoderFactory=DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE))
            decodeSingle(object:BarcodeCallback { override fun barcodeResult(result:BarcodeResult) { accept(result.text) } })
        }
        root.addView(camera,LinearLayout.LayoutParams(-1,0,1f))
        status=button("将二维码放入画面中"){}
        root.addView(status)
        root.addView(button("从图片识别") { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {type="image/*";addCategory(Intent.CATEGORY_OPENABLE)},1) })
        root.addView(button("开关补光灯") { torch=!torch;camera.setTorch(torch) })
        setContentView(root)
        if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)requestPermissions(arrayOf(Manifest.permission.CAMERA),1)
    }
    override fun onResume(){super.onResume();if(::camera.isInitialized && checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)camera.resume()}
    override fun onPause(){if(::camera.isInitialized)camera.pause();super.onPause()}
    override fun onRequestPermissionsResult(requestCode:Int,permissions:Array<out String>,results:IntArray){
        super.onRequestPermissionsResult(requestCode,permissions,results)
        if(checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)camera.resume() else status.text="未获得相机权限，可从图片识别"
    }
    private fun accept(text:String){
        if(finished)return
        if(text.length>1_000_000){status.text="二维码内容超限";return}
        finished=true;setResult(RESULT_OK,Intent().putExtra("decoded",text));finish()
    }
    @Deprecated("Platform file chooser callback")
    override fun onActivityResult(request:Int,result:Int,data:Intent?){
        super.onActivityResult(request,result,data)
        val uri=data?.data ?: return;if(result!=RESULT_OK || request!=1)return
        status.text="正在识别图片…"
        executor.execute {
            val decoded=runCatching {
                val bytes=contentResolver.openInputStream(uri)!!.use { input ->
                    val out=java.io.ByteArrayOutputStream();val buf=ByteArray(8192)
                    while(true){val n=input.read(buf);if(n<0)break;require(out.size()+n<=20*1024*1024);out.write(buf,0,n)};out.toByteArray()
                }
                val bounds=BitmapFactory.Options().apply {inJustDecodeBounds=true};BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
                require(bounds.outWidth>0&&bounds.outHeight>0)
                var sample=1;while(bounds.outWidth.toLong()/sample*(bounds.outHeight/sample)>8_000_000)sample*=2
                val bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.size,BitmapFactory.Options().apply {inSampleSize=sample}) ?: error("image")
                try {
                    val pixels=IntArray(bitmap.width*bitmap.height);bitmap.getPixels(pixels,0,bitmap.width,0,0,bitmap.width,bitmap.height)
                    var source:LuminanceSource=RGBLuminanceSource(bitmap.width,bitmap.height,pixels)
                    val hints=mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),DecodeHintType.TRY_HARDER to true)
                    var text:String?=null
                    for(invert in listOf(false,true)) {
                        val result=runCatching { MultiFormatReader().decode(BinaryBitmap(HybridBinarizer(if(invert)source.invert() else source)),hints).text }.getOrNull()
                        if(result!=null){text=result;break}
                    }
                    text ?: error("no QR")
                } finally {bitmap.recycle()}
            }
            runOnUiThread {if(!isFinishing && !isDestroyed)decoded.onSuccess(::accept).onFailure {status.text="未识别到二维码，请选择更清晰的图片"}}
        }
    }
    override fun onDestroy(){executor.shutdownNow();super.onDestroy()}
}
