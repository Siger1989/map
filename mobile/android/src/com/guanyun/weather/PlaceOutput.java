package com.guanyun.weather;

import android.content.Intent;

/** User-triggered plain-text location sharing; the chosen recipient remains with Android. */
final class PlaceOutput {
    static String share(MainActivity activity, String text) {
        if (text == null || text.trim().isEmpty() || text.length() > 4096) return "地点分享内容无效";
        activity.runOnUiThread(() -> {
            if (!activity.trustedForeground()) return;
            try {
                Intent intent = new Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, "山兔地点").putExtra(Intent.EXTRA_TEXT, text);
                activity.startActivity(Intent.createChooser(intent, "分享地点"));
            } catch (Exception e) {
                android.widget.Toast.makeText(activity, "无法打开系统分享，请复制地点信息", android.widget.Toast.LENGTH_SHORT).show();
            }
        });
        return "ok";
    }
}
