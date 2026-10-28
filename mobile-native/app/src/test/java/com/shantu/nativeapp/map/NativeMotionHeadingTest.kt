package com.shantu.nativeapp.map

import org.junit.Assert.*
import org.junit.Test

class NativeMotionHeadingTest {
    @Test fun jitterDoesNotBecomeDirection(){
        val heading=NativeMotionHeading()
        for(i in 0..20)heading.update(NativePositionFix(30.0+(i%2)*.00001,104.0,10.0,1000L+i*1000),1000L+i*1000)
        assertNull(heading.heading)
    }
    @Test fun displacementEstablishesActualCourseAndRejectsNetwork(){
        val h=NativeMotionHeading();h.update(NativePositionFix(30.0,104.0,2.0,1000),1000)
        h.update(NativePositionFix(30.0002,104.0,2.0,6000),6000)
        assertEquals(0.0,h.heading!!,1e-4)
        h.update(NativePositionFix(30.0,104.1,2.0,7000,"network",50.0,90.0,2.0),7000)
        assertEquals(0.0,h.heading!!,1e-4)
    }
    @Test fun singleLargeGpsTurnNeedsConfirmation(){
        val h=NativeMotionHeading()
        h.update(NativePositionFix(30.0,104.0,2.0,1000,speedMetersPerSecond=5.0,courseDegrees=0.0,courseAccuracyDegrees=5.0),1000)
        h.update(NativePositionFix(30.0001,104.0,2.0,2000,speedMetersPerSecond=5.0,courseDegrees=180.0,courseAccuracyDegrees=5.0),2000)
        assertEquals(0.0,h.heading!!,0.0)
    }
}
