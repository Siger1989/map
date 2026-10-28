#include <jni.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include "dwg.h"
#include "bits.h"
#include "out_dxf.h"

/* Serial caller owns temporary files; library verbosity is zero, never logs user paths. */
JNIEXPORT jint JNICALL Java_com_shantu_nativeapp_cad_NativeDwgDecoder_convertNative
 (JNIEnv *env, jobject self, jstring input, jstring output) {
    const char *in=(*env)->GetStringUTFChars(env,input,NULL);
    const char *out=(*env)->GetStringUTFChars(env,output,NULL);
    if(!in||!out)return -1;
    Dwg_Data dwg; memset(&dwg,0,sizeof(dwg));
    int result=dwg_read_file(in,&dwg);
    if(result<DWG_ERR_CRITICAL && dwg.num_objects<=100000) {
        Bit_Chain dat;memset(&dat,0,sizeof(dat));
        dat.version=dwg.header.version;dat.from_version=dwg.header.from_version;
        dat.fh=fopen(out,"wb");
        if(dat.fh){result=dwg_write_dxf(&dat,&dwg);fclose(dat.fh);}else result=DWG_ERR_IOERROR;
    } else result=DWG_ERR_CRITICAL;
    dwg_free(&dwg);
    (*env)->ReleaseStringUTFChars(env,input,in);(*env)->ReleaseStringUTFChars(env,output,out);
    struct stat info;
    return result>=DWG_ERR_CRITICAL || stat(out,&info)!=0 || info.st_size>20*1024*1024 ? -1 : 0;
}
