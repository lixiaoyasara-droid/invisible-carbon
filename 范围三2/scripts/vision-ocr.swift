import Foundation
import AppKit
import Vision

let paths = Array(CommandLine.arguments.dropFirst())
var lines: [String] = []
var confidences: [Float] = []

for path in paths {
  guard let image = NSImage(contentsOfFile: path),
        let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    continue
  }

  let request = VNRecognizeTextRequest { request, _ in
    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
    for observation in observations {
      if let candidate = observation.topCandidates(1).first {
        lines.append(candidate.string)
        confidences.append(candidate.confidence)
      }
    }
  }
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
  request.usesLanguageCorrection = true

  let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
  try? handler.perform([request])
}

let average = confidences.isEmpty ? 0 : confidences.reduce(0, +) / Float(confidences.count)
let payload: [String: Any] = [
  "text": lines.joined(separator: "\n"),
  "averageConfidence": average
]

let data = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(data)
