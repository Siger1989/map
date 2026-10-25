import AppKit
import AVFoundation

@MainActor
final class NativeCameraService: NSObject, AVCapturePhotoCaptureDelegate, NSWindowDelegate {
    private var session: AVCaptureSession?
    private var output: AVCapturePhotoOutput?
    private var cameraWindow: NSWindow?
    private var continuation: CheckedContinuation<Any, Error>?
    private var takingPhoto = false
    private var requesting = false
    private let queue = DispatchQueue(label: "org.shantu.camera")
    var active: Bool { requesting || continuation != nil }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "ShantuCamera", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    func capture() async throws -> Any {
        guard !active else { throw failure("相机已经打开") }
        requesting = true
        defer { requesting = false }
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        if status == .notDetermined {
            guard await AVCaptureDevice.requestAccess(for: .video) else { throw failure("未允许使用相机，请在系统设置的隐私与安全性中开启") }
        } else if status != .authorized { throw failure("相机权限被拒绝或受系统限制") }
        guard let device = AVCaptureDevice.default(for: .video) else { throw failure("这台 Mac 没有可用摄像头，请导入照片") }
        let input = try AVCaptureDeviceInput(device: device)
        let capture = AVCaptureSession()
        capture.sessionPreset = .photo
        let photo = AVCapturePhotoOutput()
        guard capture.canAddInput(input), capture.canAddOutput(photo) else { throw failure("摄像头无法用于拍照") }
        capture.addInput(input)
        capture.addOutput(photo)
        session = capture
        output = photo
        let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 520),
                             styleMask: [.titled, .closable], backing: .buffered, defer: false)
        panel.title = "山兔 · 拍照"
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 640, height: 520))
        let preview = NSView(frame: NSRect(x: 0, y: 64, width: 640, height: 456))
        preview.wantsLayer = true
        let layer = AVCaptureVideoPreviewLayer(session: capture)
        layer.frame = preview.bounds
        layer.videoGravity = .resizeAspect
        preview.layer?.addSublayer(layer)
        view.addSubview(preview)
        let cancel = NSButton(title: "取消", target: self, action: #selector(cancelCapture))
        cancel.frame = NSRect(x: 180, y: 15, width: 120, height: 34)
        cancel.bezelStyle = .rounded
        let take = NSButton(title: "拍照并使用", target: self, action: #selector(takePhoto))
        take.frame = NSRect(x: 320, y: 15, width: 140, height: 34)
        take.bezelStyle = .rounded
        take.keyEquivalent = "\r"
        view.addSubview(cancel)
        view.addSubview(take)
        panel.contentView = view
        cameraWindow = panel
        return try await withCheckedThrowingContinuation { completion in
            continuation = completion
            panel.center()
            panel.makeKeyAndOrderFront(nil)
            queue.async { capture.startRunning() }
        }
    }

    @objc private func takePhoto() {
        guard !takingPhoto, let output, session?.isRunning == true else { return }
        takingPhoto = true
        let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
        output.capturePhoto(with: settings, delegate: self)
    }

    nonisolated func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let data = photo.fileDataRepresentation()
        Task { @MainActor in
            // A cancelled capture must never finish a later camera request.
            guard self.output === output, self.continuation != nil else { return }
            if error != nil { self.finish(.failure(self.failure("拍照失败，请重试"))); return }
            guard let data, !data.isEmpty, data.count <= 16 * 1024 * 1024 else {
                self.finish(.failure(self.failure("照片过大或无有效图像"))); return
            }
            self.finish(.success(["base64": data.base64EncodedString(), "mime": "image/jpeg",
                                  "name": "Shantu-photo-\(Int(Date().timeIntervalSince1970)).jpg"]))
        }
    }

    @objc private func cancelCapture() { finish(.success("cancelled")) }
    func windowShouldClose(_ sender: NSWindow) -> Bool { cancelCapture(); return false }
    func shutdown() { cancelCapture() }

    private func finish(_ result: Result<Any, Error>) {
        let completion = continuation
        continuation = nil
        takingPhoto = false
        if let capture = session { queue.async { capture.stopRunning() } }
        session = nil
        output = nil
        cameraWindow?.orderOut(nil)
        cameraWindow?.delegate = nil
        cameraWindow?.close()
        cameraWindow = nil
        completion?.resume(with: result)
    }
}
