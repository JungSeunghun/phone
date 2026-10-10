import XCTest
import PhoneMirrorCore

final class ScreenCoordinateTests: XCTestCase {
    func testPortraitLetterboxAndCoordinateBoundaries() {
        let image = CGSize(width: 100, height: 200), viewport = CGSize(width: 400, height: 400)
        XCTAssertEqual(ScreenCoordinates.map(CGPoint(x: 100, y: 0), viewport: viewport, image: image), .zero)
        XCTAssertEqual(ScreenCoordinates.map(CGPoint(x: 300, y: 400), viewport: viewport, image: image), CGPoint(x: 99, y: 199))
        XCTAssertNil(ScreenCoordinates.map(CGPoint(x: 99.999, y: 100), viewport: viewport, image: image))
        XCTAssertNil(ScreenCoordinates.map(CGPoint(x: 300.001, y: 100), viewport: viewport, image: image))
        XCTAssertEqual(ScreenCoordinates.map(CGPoint(x: -100, y: 500), viewport: viewport, image: image, clamp: true), CGPoint(x: 0, y: 199))
    }
    func testInvalidDimensionsAndNonfiniteCoordinates() {
        for value in [0.0, -1, .nan, .infinity] {
            XCTAssertNil(ScreenCoordinates.map(.zero, viewport: CGSize(width: value, height: 100), image: CGSize(width: 100, height: 100)))
            XCTAssertNil(ScreenCoordinates.map(.zero, viewport: CGSize(width: 100, height: 100), image: CGSize(width: 100, height: value)))
        }
        XCTAssertNil(ScreenCoordinates.map(CGPoint(x: CGFloat.nan, y: 0), viewport: CGSize(width: 100, height: 100), image: CGSize(width: 100, height: 100), clamp: true))
    }
    func testLandscapeLetterboxAndFractionalScaling() {
        XCTAssertEqual(ScreenCoordinates.map(CGPoint(x: 150, y: 150), viewport: CGSize(width: 300, height: 300), image: CGSize(width: 200, height: 100)), CGPoint(x: 100, y: 50))
        XCTAssertNil(ScreenCoordinates.map(CGPoint(x: 150, y: 74.99), viewport: CGSize(width: 300, height: 300), image: CGSize(width: 200, height: 100)))
    }
}
