import Foundation

public enum ScreenCoordinates {
    /// Maps a letterboxed preview to pixels. Dragging may clamp to the image edge.
    public static func map(_ point: CGPoint, viewport: CGSize, image: CGSize, clamp: Bool = false) -> CGPoint? {
        guard point.x.isFinite, point.y.isFinite, [viewport.width, viewport.height, image.width, image.height].allSatisfy({ $0.isFinite && $0 > 0 }), image.width >= 1, image.height >= 1 else { return nil }
        let scale = min(viewport.width / image.width, viewport.height / image.height)
        guard scale.isFinite, scale > 0 else { return nil }
        let origin = CGPoint(x: (viewport.width - image.width * scale) / 2, y: (viewport.height - image.height * scale) / 2)
        let x = (point.x - origin.x) / scale, y = (point.y - origin.y) / scale
        guard clamp || (x >= 0 && y >= 0 && x <= image.width && y <= image.height) else { return nil }
        return CGPoint(x: min(image.width - 1, max(0, x)), y: min(image.height - 1, max(0, y)))
    }
}
