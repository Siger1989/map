package com.guanyun.weather;

import android.app.Activity;
import android.hardware.*;
import android.view.Surface;
import org.json.JSONObject;

/** Absolute magnetic orientation; game rotation vectors have no north reference. */
final class CompassSensor implements SensorEventListener {
    private final Activity activity;
    private final SensorManager manager;
    private final Sensor sensor;
    private boolean enabled;
    private volatile String state = "{\"error\":\"等待指南针方向\"}";
    CompassSensor(Activity activity) {
        this.activity=activity;
        manager=(SensorManager)activity.getSystemService(Activity.SENSOR_SERVICE);
        sensor=manager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
    }
    void start() { enabled=true; resume(); }
    void resume() {
        if(!enabled) return;
        state="{\"error\":\"等待指南针方向\"}";
        if(sensor==null || !manager.registerListener(this,sensor,SensorManager.SENSOR_DELAY_UI))
            state="{\"error\":\"设备暂不支持指南针，请使用正北模式\"}";
    }
    void pause() { manager.unregisterListener(this); }
    void stop() { enabled=false; pause(); }
    String snapshot() { return state; }
    @Override public void onSensorChanged(SensorEvent event) {
        if(!enabled) return;
        if(event.accuracy==SensorManager.SENSOR_STATUS_UNRELIABLE) { state="{\"error\":\"指南针需校准，请远离磁性物体\"}"; return; }
        float[] rotation=new float[9], remapped=new float[9], angles=new float[3];
        SensorManager.getRotationMatrixFromVector(rotation,event.values);
        int display=activity.getWindowManager().getDefaultDisplay().getRotation();
        int x=SensorManager.AXIS_X,y=SensorManager.AXIS_Y;
        if(display==Surface.ROTATION_90) {x=SensorManager.AXIS_Y;y=SensorManager.AXIS_MINUS_X;}
        else if(display==Surface.ROTATION_180) {x=SensorManager.AXIS_MINUS_X;y=SensorManager.AXIS_MINUS_Y;}
        else if(display==Surface.ROTATION_270) {x=SensorManager.AXIS_MINUS_Y;y=SensorManager.AXIS_X;}
        SensorManager.remapCoordinateSystem(rotation,x,y,remapped);
        SensorManager.getOrientation(remapped,angles);
        double heading=(Math.toDegrees(angles[0])+360)%360;
        try { state=new JSONObject().put("heading",heading).put("time",System.currentTimeMillis()).toString(); } catch(Exception ignored) { }
    }
    @Override public void onAccuracyChanged(Sensor sensor,int accuracy) { }
}
