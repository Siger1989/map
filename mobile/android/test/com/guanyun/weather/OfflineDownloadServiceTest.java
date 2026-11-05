package com.guanyun.weather;

/** JVM checks for offline-service treatment of absent tiles and safe failure summaries. */
public final class OfflineDownloadServiceTest {
    private static void check(boolean condition,String label){if(!condition)throw new AssertionError(label);}
    public static void main(String[] args){
        MapTileProxy.TileException absent=new MapTileProxy.TileException(404,"missing","Tile coverage unavailable");
        check(OfflineDownloadService.isMissingTile(absent),"explicit missing coverage bypasses transfer retries");
        check(!OfflineDownloadService.isMissingTile(new MapTileProxy.TileException(503,"http","provider failure")),
            "real HTTP failure remains retryable and distinct from missing coverage");
        check(OfflineDownloadService.publicFailureMessage(new MapTileProxy.TileException(503,"http","private URL and key"))
            .equals("图源HTTP请求失败（HTTP 503）"),"HTTP status is visible without exception details");
        check(OfflineDownloadService.publicFailureMessage(new MapTileProxy.TileException(502,"format","private URL and key"))
            .equals("图源响应不是有效图片"),"decode failure is safely categorized");
        System.out.println("OfflineDownloadServiceTest PASS");
    }
}
