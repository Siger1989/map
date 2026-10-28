package com.shantu.nativeapp.map

import kotlin.math.*

/** GPS displacement/course filter. Compass and planned route direction never enter it. */
class NativeMotionHeading {
    private var anchor: NativePositionFix? = null
    private var timestamp = 0L
    private var pending: Pair<Double, Long>? = null
    var heading: Double? = null; private set
    var acceptedAt = 0L; private set
    private fun wrap(x: Double) = (x % 360 + 360) % 360
    private fun delta(a: Double, b: Double) = (b - a + 540) % 360 - 180
    private fun distance(a: NativePositionFix, b: NativePositionFix): Double {
        val p = Math.toRadians(a.latitude); val q = Math.toRadians(b.latitude)
        val h = sin((q-p)/2).pow(2) + cos(p)*cos(q)*sin(Math.toRadians(b.longitude-a.longitude)/2).pow(2)
        return 12_742_000 * asin(sqrt(h.coerceIn(0.0,1.0)))
    }
    private fun accept(course: Double, time: Long) {
        val old = heading
        if(old == null) heading=wrap(course)
        else {
            val change=delta(old,course);val magnitude=abs(change)
            if(magnitude<3) { pending=null;acceptedAt=time;return }
            if(magnitude>65) {
                val previous=pending
                if(previous==null || time-previous.second>15_000 || abs(delta(previous.first,course))>32) {pending=course to time;return}
                heading=wrap(old+change*0.78)
            } else heading=wrap(old+change*(if(magnitude>24)0.55 else 0.32))
        }
        pending=null;acceptedAt=time
    }
    fun update(f: NativePositionFix, now: Long, accelerationQuiet: Boolean=false): Double? {
        if(!f.latitude.isFinite() || !f.longitude.isFinite() || f.latitude !in -90.0..90.0 || f.longitude !in -180.0..180.0 || !f.accuracyMeters.isFinite() || f.accuracyMeters<0 || now-f.timestampMillis !in -3000..10_000) return heading
        if(f.provider in listOf("network","ip") || f.accuracyMeters>30) {anchor=null;pending=null;return heading}
        if(f.timestampMillis<=timestamp)return heading
        timestamp=f.timestampMillis
        if(f.speedMetersPerSecond?.let{it.isFinite() && it<0.5}==true){anchor=f;pending=null;return heading}
        val speed=f.speedMetersPerSecond
        val course=f.courseDegrees?.takeIf {it.isFinite() && it in 0.0..<360.0 && speed!=null && speed in 1.5..80.0 && f.accuracyMeters<=25 && (f.courseAccuracyDegrees?.let {a->a.isFinite()&&a in 0.0..25.0} ?: (f.accuracyMeters<=12 && speed>=2.2))}
        val a=anchor
        if(course!=null) {
            if(heading!=null && a!=null && (speed?:0.0)<3) {
                if(f.timestampMillis-a.timestampMillis>30_000){anchor=f;pending=null;return heading}
                if(distance(a,f)<max(3.0,(a.accuracyMeters+f.accuracyMeters)*0.45))return heading
            }
            accept(course,f.timestampMillis);anchor=f;return heading
        }
        if(a!=null){
            val seconds=(f.timestampMillis-a.timestampMillis)/1000.0; val metres=distance(a,f)
            if(seconds<=0 || seconds>30 || metres/seconds>80){anchor=f;pending=null;return heading}
            if(metres>=max(6.0,(a.accuracyMeters+f.accuracyMeters)*(if(accelerationQuiet)1.25 else 0.9)) && metres/seconds>=max(0.45,(a.accuracyMeters+f.accuracyMeters)/35)) {
                val p=Math.toRadians(a.latitude);val q=Math.toRadians(f.latitude);val dl=Math.toRadians(f.longitude-a.longitude)
                accept(wrap(Math.toDegrees(atan2(sin(dl)*cos(q),cos(p)*sin(q)-sin(p)*cos(q)*cos(dl)))),f.timestampMillis);anchor=f
            }
        }else anchor=f
        return heading
    }
}
