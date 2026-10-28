package com.shantu.nativeapp.ui

import android.app.Dialog
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.widget.LinearLayout

/** Native pan/zoom document viewer. Zoom is uniform; text aspect ratio is preserved. */
object NativeImageViewer {
    fun show(context:Context,chrome:HomeChrome,title:String,bytes:ByteArray){
        val options=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeByteArray(bytes,0,bytes.size,options)
        if(options.outWidth<=0||options.outHeight<=0||options.outWidth.toLong()*options.outHeight>24_000_000)return
        val bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.size)?:return
        val dialog=Dialog(context)
        val view=object:View(context){
            var scale=0f;var panX=0f;var panY=0f;var lastX=0f;var lastY=0f
            val paint=Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
            val detector=ScaleGestureDetector(context,object:ScaleGestureDetector.SimpleOnScaleGestureListener(){override fun onScale(d:ScaleGestureDetector):Boolean{
                val next=(scale*d.scaleFactor).coerceIn(.1f,8f);val factor=next/scale
                panX=d.focusX-(d.focusX-panX)*factor;panY=d.focusY-(d.focusY-panY)*factor;scale=next;invalidate();return true
            }})
            fun fit(){if(width==0)return;scale=width.toFloat()/bitmap.width;panX=0f;panY=0f;invalidate()}
            fun zoom(value:Float){val cx=width/2f;val cy=height/2f;val f=value/scale.coerceAtLeast(.001f);panX=cx-(cx-panX)*f;panY=cy-(cy-panY)*f;scale=value;invalidate()}
            override fun onSizeChanged(w:Int,h:Int,oldw:Int,oldh:Int){super.onSizeChanged(w,h,oldw,oldh);if(scale==0f)fit()}
            override fun onDraw(c:Canvas){c.drawColor(Color.rgb(40,45,42));c.save();c.translate(panX,panY);c.scale(scale,scale);c.drawBitmap(bitmap,0f,0f,paint);c.restore()}
            override fun onTouchEvent(e:MotionEvent):Boolean{detector.onTouchEvent(e);when(e.actionMasked){MotionEvent.ACTION_DOWN->{lastX=e.x;lastY=e.y};MotionEvent.ACTION_MOVE->{if(!detector.isInProgress&&e.pointerCount==1){panX+=e.x-lastX;panY+=e.y-lastY;invalidate()};lastX=e.x;lastY=e.y};MotionEvent.ACTION_UP->performClick()};return true}
            override fun performClick():Boolean{super.performClick();return true}
        }
        val root=LinearLayout(context).apply{orientation=LinearLayout.VERTICAL;background=chrome.surface(8,ShantuColors.surface)}
        root.addView(chrome.text(title,13),LinearLayout.LayoutParams(-1,chrome.dp(32)))
        val actions=android.widget.HorizontalScrollView(context).apply{isHorizontalScrollBarEnabled=false}
        val row=LinearLayout(context);row.addView(chrome.row("适宽"){view.fit()});for(percent in listOf(25,50,100,200,400,800))row.addView(chrome.row("$percent%"){view.zoom(percent/100f)})
        row.addView(chrome.row("关闭"){dialog.dismiss()});actions.addView(row);root.addView(actions,LinearLayout.LayoutParams(-1,chrome.dp(36)))
        root.addView(view,LinearLayout.LayoutParams(-1,0,1f));dialog.setContentView(root)
        dialog.setOnDismissListener{bitmap.recycle()};dialog.show()
        dialog.window?.setLayout((context.resources.displayMetrics.widthPixels*.96).toInt(),(context.resources.displayMetrics.heightPixels*.9).toInt())
    }
}
