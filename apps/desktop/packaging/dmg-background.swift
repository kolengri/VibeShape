import AppKit

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count == 5, let brand = NSImage(contentsOfFile: arguments[1]) else {
    fputs("Expected output, brand image and three installer messages.\n", stderr)
    exit(1)
}
let width: CGFloat = 720
let height: CGFloat = 480
let scale: CGFloat = 2
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: Int(width * scale), pixelsHigh: Int(height * scale),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
), let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fputs("The installer background could not be rendered.\n", stderr)
    exit(1)
}
bitmap.size = NSSize(width: width, height: height)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = graphics
graphics.cgContext.scaleBy(x: scale, y: scale)
let bounds = NSRect(x: 0, y: 0, width: width, height: height)
let gradient = NSGradient(
    starting: NSColor(srgbRed: 0.98, green: 0.98, blue: 1, alpha: 1),
    ending: NSColor(srgbRed: 0.88, green: 0.91, blue: 1, alpha: 1)
)!
gradient.draw(in: bounds, angle: -90)
let glow = NSGradient(starting: NSColor(srgbRed: 1, green: 0.67, blue: 0.38, alpha: 0.18), ending: .clear)!
glow.draw(in: NSBezierPath(ovalIn: NSRect(x: 220, y: -100, width: 480, height: 300)), relativeCenterPosition: NSPoint(x: 0, y: 0))

func centeredText(_ text: String, top: CGFloat, size: CGFloat, weight: NSFont.Weight, color: NSColor) {
    let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color]
    let textSize = (text as NSString).size(withAttributes: attributes)
    (text as NSString).draw(at: NSPoint(x: (width - textSize.width) / 2, y: height - top - textSize.height), withAttributes: attributes)
}
let ink = NSColor(srgbRed: 0.10, green: 0.14, blue: 0.29, alpha: 1)
let title = arguments[2]
let titleAttributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 30, weight: .semibold), .foregroundColor: ink]
let titleSize = (title as NSString).size(withAttributes: titleAttributes)
let titleLeft = (width - titleSize.width - 52) / 2
brand.draw(in: NSRect(x: titleLeft, y: height - 84, width: 40, height: 40))
(title as NSString).draw(at: NSPoint(x: titleLeft + 52, y: height - 78), withAttributes: titleAttributes)
centeredText(arguments[3], top: 108, size: 18, weight: .regular, color: ink)
centeredText(arguments[4], top: 405, size: 14, weight: .regular, color: ink.withAlphaComponent(0.72))

let arrow = NSBezierPath()
arrow.move(to: NSPoint(x: 315, y: height - 238))
arrow.line(to: NSPoint(x: 405, y: height - 238))
arrow.move(to: NSPoint(x: 389, y: height - 222))
arrow.line(to: NSPoint(x: 405, y: height - 238))
arrow.line(to: NSPoint(x: 389, y: height - 254))
arrow.lineWidth = 5
arrow.lineCapStyle = .round
arrow.lineJoinStyle = .round
NSColor(srgbRed: 0.20, green: 0.29, blue: 0.85, alpha: 0.85).setStroke()
arrow.stroke()
NSGraphicsContext.restoreGraphicsState()
guard let data = bitmap.representation(using: .png, properties: [:]) else {
    fputs("The installer background could not be encoded.\n", stderr)
    exit(1)
}
try data.write(to: URL(fileURLWithPath: arguments[0]), options: .atomic)
