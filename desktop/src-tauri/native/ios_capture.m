// macOS USB screen and device audio capture. No microphone input or touch injection.
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMediaIO/CoreMediaIO.h>
#import <VideoToolbox/VideoToolbox.h>
#include <stdatomic.h>
#include <unistd.h>
typedef bool (*PacketCallback)(void *, const uint8_t *, size_t, uint64_t, bool, bool);
typedef bool (*AudioCallback)(void *, const uint8_t *, size_t, uint64_t);
typedef void (*AudioStatusCallback)(void *, const char *);
typedef bool (*StopCallback)(void *);
static char *CopyError(NSString *error) { return error ? strdup(error.UTF8String) : NULL; }
void phone_ios_free(char *value) { free(value); }
static OSStatus EnableScreenDevices(void) {
    UInt32 enabled = 1, disabled = 0;
    CMIOObjectPropertyAddress property = {kCMIOHardwarePropertyAllowWirelessScreenCaptureDevices, kCMIOObjectPropertyScopeGlobal, kCMIOObjectPropertyElementMain};
    CMIOObjectSetPropertyData(kCMIOObjectSystemObject, &property, 0, NULL, sizeof(disabled), &disabled);
    property.mSelector = kCMIOHardwarePropertyAllowScreenCaptureDevices;
    return CMIOObjectSetPropertyData(kCMIOObjectSystemObject, &property, 0, NULL, sizeof(enabled), &enabled);
}
static NSArray<AVCaptureDevice *> *ScreenDevices(void) {
    NSMutableArray *screens = [NSMutableArray array];
    for (AVCaptureDevice *device in [AVCaptureDevice devicesWithMediaType:AVMediaTypeMuxed]) {
        if ([device.modelID isEqualToString:@"iOS Device"] && device.connected) [screens addObject:device];
    }
    return screens;
}
char *phone_ios_discover(void) {
    @autoreleasepool {
        if (EnableScreenDevices() != noErr) return CopyError(@"{}");
        NSMutableArray *devices = [NSMutableArray array];
        AVAuthorizationStatus authorization = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
        for (AVCaptureDevice *device in ScreenDevices()) {
            [devices addObject:@{@"identifier":device.uniqueID, @"name":device.localizedName ?: @"iPhone", @"model":device.modelID, @"denied":@(authorization == AVAuthorizationStatusDenied || authorization == AVAuthorizationStatusRestricted)}];
        }
        NSData *json = [NSJSONSerialization dataWithJSONObject:devices options:0 error:NULL];
        return CopyError([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]);
    }
}
@interface PhoneIosEncoder : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate> {
@public
    VTCompressionSessionRef compression;
    PacketCallback callback;
    AudioCallback audioCallback;
    StopCallback stop;
    void *context;
    uint32_t dimension, frameRate;
    atomic_bool failed, delivered;
    CMTime firstTime, lastTime;
    int32_t encodedWidth, encodedHeight;
    dispatch_queue_t deliveryQueue;
    NSData *configuration;
}
- (BOOL)encode:(CVPixelBufferRef)pixel time:(CMTime)time;
- (BOOL)encodeAudio:(CMSampleBufferRef)sample;
- (void)finish;
@end
static void AppendUnit(NSMutableData *data, const uint8_t *bytes, size_t length) {
    const uint8_t prefix[] = {0,0,0,1};
    [data appendBytes:prefix length:4]; [data appendBytes:bytes length:length];
}
static void Encoded(void *reference, void *frameReference, OSStatus status, VTEncodeInfoFlags flags, CMSampleBufferRef sample) {
    (void)frameReference; (void)flags;
    PhoneIosEncoder *encoder = (__bridge PhoneIosEncoder *)reference;
    if (status != noErr || !sample || !CMSampleBufferDataIsReady(sample)) { atomic_store(&encoder->failed,true); return; }
    if (encoder->stop(encoder->context)) return;
    CFRetain(sample);
    dispatch_sync(encoder->deliveryQueue, ^{
        @autoreleasepool {
            CMFormatDescriptionRef format = CMSampleBufferGetFormatDescription(sample);
            const uint8_t *sps = NULL, *pps = NULL; size_t spsSize = 0, ppsSize = 0; int headerSize = 0;
            OSStatus a = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format,0,&sps,&spsSize,NULL,&headerSize);
            OSStatus b = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format,1,&pps,&ppsSize,NULL,NULL);
            if (a || b || headerSize != 4 || spsSize < 4 || spsSize > 65535 || ppsSize == 0 || ppsSize > 65535) { atomic_store(&encoder->failed,true); return; }
            NSMutableData *config = [NSMutableData data]; AppendUnit(config,sps,spsSize); AppendUnit(config,pps,ppsSize);
            if (![config isEqualToData:encoder->configuration]) {
                if (!encoder->callback(encoder->context,config.bytes,config.length,0,true,false)) { atomic_store(&encoder->failed,true); return; }
                encoder->configuration = config;
            }
            CMBlockBufferRef block = CMSampleBufferGetDataBuffer(sample);
            size_t size = block ? CMBlockBufferGetDataLength(block) : 0;
            if (size < 5 || size > 16 * 1024 * 1024) { atomic_store(&encoder->failed,true); return; }
            NSMutableData *avcc = [NSMutableData dataWithLength:size];
            if (CMBlockBufferCopyDataBytes(block,0,size,avcc.mutableBytes) != noErr) { atomic_store(&encoder->failed,true); return; }
            const uint8_t *bytes = avcc.bytes; size_t offset = 0;
            NSMutableData *annex = [NSMutableData dataWithCapacity:size];
            while (offset < size) {
                if (size-offset < 4) { atomic_store(&encoder->failed,true); return; }
                uint32_t length = ((uint32_t)bytes[offset]<<24) | ((uint32_t)bytes[offset+1]<<16) | ((uint32_t)bytes[offset+2]<<8) | bytes[offset+3]; offset+=4;
                if (length==0 || length>size-offset) { atomic_store(&encoder->failed,true); return; }
                AppendUnit(annex,bytes+offset,length); offset+=length;
            }
            CMTime time = CMTimeConvertScale(CMSampleBufferGetPresentationTimeStamp(sample),1000000,kCMTimeRoundingMethod_Default);
            if (!CMTIME_IS_NUMERIC(time) || time.value < 0 || time.value >= (1LL<<53)) { atomic_store(&encoder->failed,true); return; }
            NSArray *attachments = (__bridge NSArray *)CMSampleBufferGetSampleAttachmentsArray(sample,false);
            BOOL key = attachments.count == 0 || ![attachments[0][(__bridge NSString *)kCMSampleAttachmentKey_NotSync] boolValue];
            if (!encoder->callback(encoder->context,annex.bytes,annex.length,(uint64_t)time.value,false,key)) atomic_store(&encoder->failed,true);
            else atomic_store(&encoder->delivered,true);
        }
    });
    CFRelease(sample);
}
@implementation PhoneIosEncoder
- (instancetype)init {
    self = [super init]; if (self) { firstTime = kCMTimeInvalid; lastTime = kCMTimeInvalid; atomic_init(&failed,false); atomic_init(&delivered,false); deliveryQueue = dispatch_queue_create("local.phone.ios.delivery",DISPATCH_QUEUE_SERIAL); } return self;
}
- (BOOL)encode:(CVPixelBufferRef)pixel time:(CMTime)time {
    if (stop(context) || atomic_load(&failed) || !CMTIME_IS_NUMERIC(time)) return NO;
    size_t sourceWidth = CVPixelBufferGetWidth(pixel), sourceHeight = CVPixelBufferGetHeight(pixel);
    if (sourceWidth<1 || sourceHeight<1 || sourceWidth>8192 || sourceHeight>8192) { atomic_store(&failed,true); return NO; }
    double scale = MIN(1.0,(double)dimension/MAX(sourceWidth,sourceHeight));
    int32_t width = MAX(2, ((int32_t)(sourceWidth*scale)) & ~1), height = MAX(2, ((int32_t)(sourceHeight*scale)) & ~1);
    if (compression && (width!=encodedWidth || height!=encodedHeight)) { [self finish]; configuration=nil; }
    if (!compression) {
        encodedWidth = width; encodedHeight = height;
        OSStatus result = VTCompressionSessionCreate(NULL,width,height,kCMVideoCodecType_H264,NULL,NULL,NULL,Encoded,(__bridge void *)self,&compression);
        if (result) { atomic_store(&failed,true); return NO; }
        NSDictionary *properties = @{(__bridge NSString *)kVTCompressionPropertyKey_RealTime:@YES,
            (__bridge NSString *)kVTCompressionPropertyKey_AllowFrameReordering:@NO,
            (__bridge NSString *)kVTCompressionPropertyKey_ProfileLevel:(__bridge NSString *)kVTProfileLevel_H264_Baseline_AutoLevel,
            (__bridge NSString *)kVTCompressionPropertyKey_AverageBitRate:@8000000,
            (__bridge NSString *)kVTCompressionPropertyKey_ExpectedFrameRate:@(frameRate),
            (__bridge NSString *)kVTCompressionPropertyKey_MaxKeyFrameInterval:@(frameRate),
            (__bridge NSString *)kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration:@1};
        if (VTSessionSetProperties(compression,(__bridge CFDictionaryRef)properties) || VTCompressionSessionPrepareToEncodeFrames(compression)) { atomic_store(&failed,true); return NO; }
    }
    if (!CMTIME_IS_VALID(firstTime)) firstTime=time;
    CMTime relative = CMTimeSubtract(time,firstTime);
    if (!CMTIME_IS_NUMERIC(relative)) { atomic_store(&failed,true); return NO; }
    if (CMTimeCompare(relative,kCMTimeZero)<0) return YES; // Late pre-epoch video is preroll.
    if (CMTIME_IS_VALID(lastTime) && CMTimeGetSeconds(CMTimeSubtract(relative,lastTime)) < (1.0/frameRate)-0.000001) return YES;
    lastTime=relative;
    if (VTCompressionSessionEncodeFrame(compression,pixel,relative,CMTimeMake(1,frameRate),NULL,NULL,NULL)) { atomic_store(&failed,true); return NO; }
    return YES;
}
- (void)captureOutput:(AVCaptureOutput *)output didOutputSampleBuffer:(CMSampleBufferRef)sample fromConnection:(AVCaptureConnection *)connection {
    (void)output; (void)connection;
    if ([output isKindOfClass:AVCaptureAudioDataOutput.class]) { [self encodeAudio:sample]; return; }
    CVPixelBufferRef pixel = CMSampleBufferGetImageBuffer(sample);
    if (pixel) [self encode:pixel time:CMSampleBufferGetPresentationTimeStamp(sample)];
}
// AudioDataOutput is explicitly configured to this shared PCM wire format.
// Both delegates run on captureQueue, so firstTime is one common capture epoch.
- (BOOL)encodeAudio:(CMSampleBufferRef)sample {
    if (!audioCallback || stop(context) || atomic_load(&failed)) return NO;
    CMTime sourceTime = CMSampleBufferGetPresentationTimeStamp(sample);
    const AudioStreamBasicDescription *format = CMAudioFormatDescriptionGetStreamBasicDescription(CMSampleBufferGetFormatDescription(sample));
    CMItemCount count = CMSampleBufferGetNumSamples(sample);
    if (!format || format->mFormatID != kAudioFormatLinearPCM || format->mSampleRate != 48000 || format->mChannelsPerFrame != 2 || format->mBitsPerChannel != 16 || format->mBytesPerFrame != 4 || !(format->mFormatFlags & kAudioFormatFlagIsSignedInteger) || (format->mFormatFlags & (kAudioFormatFlagIsBigEndian | kAudioFormatFlagIsNonInterleaved | kAudioFormatFlagIsFloat)) || count < 1 || count > 48000 || !CMTIME_IS_NUMERIC(sourceTime)) {
        atomic_store(&failed,true); return NO;
    }
    if (!CMTIME_IS_VALID(firstTime)) firstTime=sourceTime;
    CMTime relative = CMTimeConvertScale(CMTimeSubtract(sourceTime,firstTime),1000000,kCMTimeRoundingMethod_Default);
    if (!CMTIME_IS_NUMERIC(relative) || relative.value >= (1LL<<53) || relative.value <= -(1LL<<53)) { atomic_store(&failed,true); return NO; }
    // Audio can arrive after video despite an earlier PTS. Trim only the preroll samples.
    CMItemCount firstFrame=0;
    if (relative.value < 0) {
        if (relative.value <= -((count*1000000+47999)/48000)) return YES;
        uint64_t trim=((uint64_t)(-relative.value)*48000+999999)/1000000;
        if (trim >= (uint64_t)count) return YES;
        firstFrame=(CMItemCount)trim;
    }
    uint8_t bytes[4096];
    for (CMItemCount offset=firstFrame; offset<count; offset+=1024) {
        CMItemCount frames=MIN((CMItemCount)1024,count-offset);
        AudioBufferList list={.mNumberBuffers=1,.mBuffers={{.mNumberChannels=2,.mDataByteSize=(UInt32)(frames*4),.mData=bytes}}};
        if (CMSampleBufferCopyPCMDataIntoAudioBufferList(sample,(int32_t)offset,(int32_t)frames,&list)) { atomic_store(&failed,true); return NO; }
        int64_t alignedTime=relative.value + (int64_t)((offset*1000000+24000)/48000);
        if (alignedTime < 0) { atomic_store(&failed,true); return NO; }
        uint64_t time=(uint64_t)alignedTime;
        if (time >= (1ULL<<53) || !audioCallback(context,bytes,(size_t)frames*4,time)) { atomic_store(&failed,true); return NO; }
    }
    return YES;
}
- (void)finish { if (compression) { VTCompressionSessionCompleteFrames(compression,kCMTimeInvalid); VTCompressionSessionInvalidate(compression); CFRelease(compression); compression=NULL; } }
@end
static PhoneIosEncoder *NewEncoder(uint32_t dimension,uint32_t fps,PacketCallback callback,StopCallback stop,void *context) {
    PhoneIosEncoder *encoder = [PhoneIosEncoder new]; encoder->dimension=dimension; encoder->frameRate=fps; encoder->callback=callback; encoder->stop=stop; encoder->context=context; return encoder;
}
char *phone_ios_run(const char *identifier,uint32_t dimension,uint32_t fps,PacketCallback callback,AudioCallback audioCallback,AudioStatusCallback audioStatus,StopCallback stop,void *context) {
    @autoreleasepool {
        if (!identifier || !callback || !stop || dimension<2 || dimension>3840 || fps<1 || fps>60) return CopyError(@"잘못된 iPhone 캡처 설정입니다.");
        if (stop(context)) return NULL;
        if (EnableScreenDevices()) return CopyError(@"Mac USB 화면 캡처를 활성화할 수 없습니다.");
        NSString *uid = [NSString stringWithUTF8String:identifier]; AVCaptureDevice *selected = nil;
        for (AVCaptureDevice *device in ScreenDevices()) if ([device.uniqueID isEqualToString:uid]) selected=device;
        if (!selected) return CopyError(@"iPhone USB 화면 장치가 없습니다. 잠금을 해제하고 이 컴퓨터를 신뢰한 뒤 다시 연결하세요.");
        AVAuthorizationStatus authorization = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
        if (authorization==AVAuthorizationStatusNotDetermined) {
            dispatch_semaphore_t ready = dispatch_semaphore_create(0);
            [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo completionHandler:^(BOOL granted) { (void)granted; dispatch_semaphore_signal(ready); }];
            NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:15];
            while (dispatch_semaphore_wait(ready,dispatch_time(DISPATCH_TIME_NOW,100*NSEC_PER_MSEC))!=0) { if (stop(context)) return NULL; if (deadline.timeIntervalSinceNow<0) return CopyError(@"카메라 권한 응답 시간이 초과됐습니다. 시스템 설정에서 허용하세요."); }
            authorization = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
        }
        if (authorization!=AVAuthorizationStatusAuthorized) return CopyError(@"iPhone 화면 수신을 위한 카메라 권한을 시스템 설정에서 허용하세요.");
        if (stop(context)) return NULL;
        NSError *inputError = nil; AVCaptureDeviceInput *input = [AVCaptureDeviceInput deviceInputWithDevice:selected error:&inputError];
        if (!input) return CopyError(@"iPhone 화면 입력을 열 수 없습니다. 다른 캡처 앱 사용 여부와 USB 신뢰 상태를 확인하세요.");
        AVCaptureSession *session = [AVCaptureSession new]; AVCaptureVideoDataOutput *output = [AVCaptureVideoDataOutput new];
        output.alwaysDiscardsLateVideoFrames=YES;
        output.videoSettings = @{(__bridge NSString *)kCVPixelBufferPixelFormatTypeKey:@(kCVPixelFormatType_32BGRA)};
        PhoneIosEncoder *encoder = NewEncoder(dimension,fps,callback,stop,context);
        encoder->audioCallback=audioCallback;
        AVCaptureAudioDataOutput *audioOutput = [AVCaptureAudioDataOutput new];
        audioOutput.audioSettings = @{AVFormatIDKey:@(kAudioFormatLinearPCM), AVSampleRateKey:@48000, AVNumberOfChannelsKey:@2, AVLinearPCMBitDepthKey:@16, AVLinearPCMIsFloatKey:@NO, AVLinearPCMIsBigEndianKey:@NO, AVLinearPCMIsNonInterleaved:@NO};
        dispatch_queue_t captureQueue = dispatch_queue_create("local.phone.ios.capture",DISPATCH_QUEUE_SERIAL);
        [output setSampleBufferDelegate:encoder queue:captureQueue];
        if (![session canAddInput:input]) return CopyError(@"iPhone 화면 입력을 연결할 수 없습니다.");
        [session addInput:input]; if (![session canAddOutput:output]) return CopyError(@"iPhone 화면 출력을 연결할 수 없습니다."); [session addOutput:output];
        BOOL hasAudioPort=NO;
        for (AVCaptureInputPort *port in input.ports) if ([port.mediaType isEqualToString:AVMediaTypeAudio]) hasAudioPort=YES;
        BOOL audioAuthorized=YES;
        if (audioCallback && hasAudioPort) {
            AVAuthorizationStatus audioAuthorization=[AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
            if (audioAuthorization==AVAuthorizationStatusNotDetermined) {
                dispatch_semaphore_t audioReady=dispatch_semaphore_create(0);
                [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) { (void)granted; dispatch_semaphore_signal(audioReady); }];
                NSDate *audioDeadline=[NSDate dateWithTimeIntervalSinceNow:15];
                while (dispatch_semaphore_wait(audioReady,dispatch_time(DISPATCH_TIME_NOW,100*NSEC_PER_MSEC))!=0) {
                    if (stop(context)) return NULL;
                    if (audioDeadline.timeIntervalSinceNow<0) break;
                }
                audioAuthorization=[AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
            }
            audioAuthorized=audioAuthorization==AVAuthorizationStatusAuthorized;
        }
        if (audioCallback && hasAudioPort && audioAuthorized && [session canAddOutput:audioOutput]) {
            [audioOutput setSampleBufferDelegate:encoder queue:captureQueue];
            [session addOutput:audioOutput];
        } else if (audioStatus) audioStatus(context,hasAudioPort ? "iPhone USB 소리 수신 권한 또는 출력을 사용할 수 없습니다. 영상만 수신합니다." : "iPhone USB 오디오 포트가 없습니다. 영상만 수신합니다.");
        __block atomic_bool runtimeFailed; atomic_init(&runtimeFailed,false);
        id observer = [[NSNotificationCenter defaultCenter] addObserverForName:AVCaptureSessionRuntimeErrorNotification object:session queue:nil usingBlock:^(NSNotification *note) { (void)note; atomic_store(&runtimeFailed,true); }];
        [session startRunning]; NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:15];
        while (!stop(context) && selected.connected && session.running && !atomic_load(&encoder->failed) && !atomic_load(&runtimeFailed)) {
            if (!atomic_load(&encoder->delivered) && deadline.timeIntervalSinceNow<0) break;
            usleep(20000);
        }
        [session stopRunning]; [output setSampleBufferDelegate:nil queue:NULL]; [audioOutput setSampleBufferDelegate:nil queue:NULL]; dispatch_sync(captureQueue,^{}); [encoder finish];
        [[NSNotificationCenter defaultCenter] removeObserver:observer];
        if (stop(context)) return NULL;
        if (atomic_load(&encoder->failed)) return CopyError(@"iPhone 영상 인코딩 또는 전달에 실패했습니다.");
        if (!selected.connected) return CopyError(@"iPhone USB 연결이 끊겼습니다.");
        if (!atomic_load(&encoder->delivered)) return CopyError(@"iPhone 영상이 도착하지 않았습니다. 잠금 해제와 USB 신뢰 상태를 확인하세요.");
        return CopyError(@"iPhone 화면 수신이 중단됐습니다.");
    }
}
char *phone_ios_verify(PacketCallback callback,StopCallback stop,void *context) {
    @autoreleasepool {
        PhoneIosEncoder *encoder = NewEncoder(720,30,callback,stop,context);
        for (int i=0;i<30 && !stop(context);i++) {
            CVPixelBufferRef pixel=NULL;
            if (CVPixelBufferCreate(NULL,320,640,kCVPixelFormatType_32BGRA,(__bridge CFDictionaryRef)@{(__bridge NSString *)kCVPixelBufferIOSurfacePropertiesKey:@{}},&pixel)) return CopyError(@"모의 영상 생성에 실패했습니다.");
            CVPixelBufferLockBaseAddress(pixel,0); uint8_t *bytes = CVPixelBufferGetBaseAddress(pixel); size_t stride=CVPixelBufferGetBytesPerRow(pixel);
            for (size_t y=0;y<640;y++) for (size_t x=0;x<320;x++) { size_t p=y*stride+x*4; bytes[p]=(x+i*5)%256; bytes[p+1]=(y+i*3)%256; bytes[p+2]=100; bytes[p+3]=255; }
            CVPixelBufferUnlockBaseAddress(pixel,0); [encoder encode:pixel time:CMTimeMake(i,30)]; CVPixelBufferRelease(pixel);
        }
        [encoder finish]; return atomic_load(&encoder->failed) ? CopyError(@"네이티브 모의 인코딩에 실패했습니다.") : NULL;
    }
}

// Short synthetic sample buffers exercise the same USB delegate conversion and shared epoch.
char *phone_ios_verify_media(PacketCallback callback,AudioCallback audio,StopCallback stop,void *context) {
    @autoreleasepool {
        if (stop(context)) return NULL;
        PhoneIosEncoder *encoder=NewEncoder(720,30,callback,stop,context); encoder->audioCallback=audio;
        for (int index=0;index<8 && !stop(context);index++) {
            CVPixelBufferRef pixel=NULL;
            if (CVPixelBufferCreate(NULL,320,640,kCVPixelFormatType_32BGRA,(__bridge CFDictionaryRef)@{(__bridge NSString *)kCVPixelBufferIOSurfacePropertiesKey:@{}},&pixel)) return CopyError(@"모의 영상 생성에 실패했습니다.");
            CVPixelBufferLockBaseAddress(pixel,0); memset(CVPixelBufferGetBaseAddress(pixel),index*20,CVPixelBufferGetBytesPerRow(pixel)*640); CVPixelBufferUnlockBaseAddress(pixel,0);
            [encoder encode:pixel time:CMTimeMake(300+index,30)]; CVPixelBufferRelease(pixel);
        }
        [encoder finish];
        if (!stop(context)) {
            AudioStreamBasicDescription format={.mSampleRate=48000,.mFormatID=kAudioFormatLinearPCM,.mFormatFlags=kAudioFormatFlagIsSignedInteger|kAudioFormatFlagIsPacked,.mBytesPerPacket=4,.mFramesPerPacket=1,.mBytesPerFrame=4,.mChannelsPerFrame=2,.mBitsPerChannel=16};
            CMAudioFormatDescriptionRef description=NULL;
            if (CMAudioFormatDescriptionCreate(NULL,&format,0,NULL,0,NULL,NULL,&description)) return CopyError(@"모의 오디오 형식 생성에 실패했습니다.");
            CMBlockBufferRef block=NULL;
            OSStatus result=CMBlockBufferCreateWithMemoryBlock(NULL,NULL,8000*4,NULL,NULL,0,8000*4,0,&block);
            if (!result) {
                int16_t pcm[8000*2];
                for (int i=0;i<8000;i++) { int16_t tone=(int16_t)(10000*sin(2*M_PI*440*i/48000.0)); pcm[i*2]=tone; pcm[i*2+1]=tone; }
                result=CMBlockBufferReplaceDataBytes(pcm,block,0,sizeof(pcm));
            }
            CMSampleBufferRef sample=NULL;
            // Simulate a late-arriving buffer from before the shared video epoch.
            if (!result) result=CMAudioSampleBufferCreateReadyWithPacketDescriptions(NULL,block,description,480,CMTimeMake(999,100),NULL,&sample);
            if (!result) { [encoder encodeAudio:sample]; CFRelease(sample); sample=NULL; }
            if (!result) result=CMAudioSampleBufferCreateReadyWithPacketDescriptions(NULL,block,description,8000,CMTimeMake(101,10),NULL,&sample);
            if (!result) { [encoder encodeAudio:sample]; CFRelease(sample); }
            if (block) CFRelease(block); CFRelease(description);
            if (result) return CopyError(@"모의 오디오 생성에 실패했습니다.");
        }
        return atomic_load(&encoder->failed) ? CopyError(@"네이티브 화면·소리 모의 수신에 실패했습니다.") : NULL;
    }
}
