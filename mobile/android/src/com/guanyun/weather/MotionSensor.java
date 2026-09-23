package com.guanyun.weather;

import android.app.Activity;
import android.hardware.*;
import org.json.JSONObject;

/** Gravity-free acceleration is only a motion confidence hint, never an absolute compass. */
final class MotionSensor implements SensorEventListener {
    private final SensorManager manager;
    private final Sensor sensor;
    private boolean enabled;
    private double energy;
    private volatile String state = "{}";
    MotionSensor(Activity activity) {
        manager=(SensorManager)activity.getSystemService(Activity.SENSOR_SERVICE);
        sensor=manager==null?null:manager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION);
    }
    void start() { enabled=true; resume(); }
    void resume() { state="{}";energy=0; if(enabled&&sensor!=null)manager.registerListener(this,sensor,SensorManager.SENSOR_DELAY_UI); }
    void pause() { if(manager!=null)manager.unregisterListener(this);state="{}"; }
    void stop() { enabled=false;pause(); }
    String snapshot() { return state; }
    @Override public void onSensorChanged(SensorEvent event) {
        if(!enabled)return;
        double norm=0;for(int i=0;i<3;i++)norm+=event.values[i]*event.values[i];
        energy=energy*0.8+norm*0.2;
        try{state=new JSONObject().put("rms",Math.sqrt(energy)).put("time",System.currentTimeMillis()).toString();}catch(Exception ignored){}
    }
    @Override public void onAccuracyChanged(Sensor sensor,int accuracy){}
}
