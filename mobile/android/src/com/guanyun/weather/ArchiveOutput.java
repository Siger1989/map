package com.guanyun.weather;

import android.content.Intent;
import android.net.Uri;
import java.io.File;

final class ArchiveOutput {
    final ArchiveTransfer transfer;
    private final MainActivity activity;
    private final AppFiles files;
    ArchiveOutput(MainActivity activity, AppFiles files) {
        this.activity = activity; this.files = files;
        transfer = new ArchiveTransfer(new File(activity.getCacheDir(), "archive-pending"));
    }
    String finish(String token, boolean share) {
        String name = transfer.name(token);
        final File file;
        try { file = transfer.finish(token); }
        catch (Exception e) { return e.getMessage() == null ? "压缩包校验失败" : e.getMessage(); }
        activity.runOnUiThread(() -> {
            if (!activity.trustedForeground()) { file.delete(); return; }
            if (!share) { files.saveGenerated(name, "application/zip", file); return; }
            try {
                Uri uri = RouteShareProvider.prepareFile(activity, file, "zip");
                Intent intent = new Intent(Intent.ACTION_SEND).setType("application/zip").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.setClipData(android.content.ClipData.newRawUri("山兔压缩包", uri));
                activity.startActivity(Intent.createChooser(intent, "分享压缩包"));
            } catch (Exception e) { file.delete(); android.widget.Toast.makeText(activity, "无法打开分享，请保存压缩包后分享", 0).show(); }
        });
        return "ok";
    }
}
