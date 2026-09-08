package com.guanyun.weather;
import android.content.Intent;
import android.net.Uri;

final class RouteOutput {
    static String file(MainActivity activity, AppFiles files, String name, String encoded, boolean share) {
        if(name==null || !name.matches("Shantu-route-[0-9]{1,16}\\.(jpg|gpx|kml)") || encoded==null || encoded.length()>12*1024*1024) return "路线文件过大或名称无效";
        final byte[] bytes;
        try{bytes=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);}catch(Exception e){return "路线文件编码无效";}
        if(bytes.length<3 || bytes.length>8*1024*1024)return "路线文件大小无效";
        String extension=name.substring(name.lastIndexOf('.')+1), mime=RouteShareProvider.mime(name);
        if("jpg".equals(extension) && ((bytes[0]&255)!=255 || (bytes[1]&255)!=216 || (bytes[2]&255)!=255)) return "图片格式无效";
        activity.runOnUiThread(()->{
            if(!activity.trustedForeground())return;
            if(!share){if("jpg".equals(extension))files.savePhoto(name,bytes);else files.save(name,mime,new String(bytes,java.nio.charset.StandardCharsets.UTF_8));return;}
            new Thread(()->{
                try{Uri uri=RouteShareProvider.prepare(activity,bytes,extension);activity.runOnUiThread(()->{
                    if(!activity.trustedForeground())return;
                    try{Intent intent=new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);intent.setClipData(android.content.ClipData.newRawUri("山兔路线",uri));activity.startActivity(Intent.createChooser(intent,"分享路线"));}
                    catch(Exception e){android.widget.Toast.makeText(activity,"无法打开系统分享，请保存文件后分享",0).show();}
                });}catch(Exception e){activity.runOnUiThread(()->android.widget.Toast.makeText(activity,"路线文件生成失败",0).show());}
            },"shantu-route-share").start();
        });return "ok";
    }
    static String link(MainActivity activity,String value){
        if(value==null || value.length()>12000)return "导航链接无效";
        Uri uri=Uri.parse(value);
        if(!"https".equals(uri.getScheme()) || !"uri.amap.com".equals(uri.getHost()) || !"/navigation".equals(uri.getPath())) return "导航链接无效";
        activity.runOnUiThread(()->{if(!activity.trustedForeground())return;try{activity.startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,value),"分享导航链接"));}catch(Exception e){android.widget.Toast.makeText(activity,"无法打开系统分享",0).show();}});return "ok";
    }
}
