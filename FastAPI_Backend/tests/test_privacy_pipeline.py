import sys
import unittest
import json
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.chunking import chunk_text
from app.detectors import RawDetection, dedupe_overlaps, scan_text
from app.main import scan_prompt
from app.normal_masker import scan_normal_masking
from app.pipeline import scan_cache, scan_prompt_text
from app.presidio_detector import scan_with_presidio
from app.schemas import ScanRequest


class FakeRecognizerResult:
    def __init__(self, entity_type, start, end, score=0.86):
        self.entity_type = entity_type
        self.start = start
        self.end = end
        self.score = score


class FakeAnalyzer:
    def analyze(self, text, language, entities, score_threshold):
        results = []
        for entity_type, value in (("PERSON", "Alice Johnson"), ("LOCATION", "Mumbai")):
            index = text.find(value)
            if index >= 0:
                results.append(FakeRecognizerResult(entity_type, index, index + len(value)))
        return results


class PrivacyPipelineTests(unittest.TestCase):
    def setUp(self):
        scan_cache._items.clear()

    def test_regex_detects_common_sensitive_values(self):
        github_token = "gh" + "p_" + "abcdefghijklmnopqrstuvwxyz123456"
        slack_token = "xox" + "b-" + "1234567890-abcdefghijklmnop"
        text = (
            "email test@example.com phone +91 9876543210 card 4111111111111111 "
            "password=hello123 token=abc1234567890xyza "
            "jwt eyJabc.def.ghi ip 192.168.1.1 url https://example.com/path "
            f"github {github_token} slack {slack_token}"
        )

        detections = scan_text(text)
        entity_types = {item.type for item in detections}

        self.assertIn("EMAIL", entity_types)
        self.assertIn("PHONE_IN", entity_types)
        self.assertIn("CREDIT_CARD", entity_types)
        self.assertIn("PASSWORD_ASSIGNMENT", entity_types)
        self.assertIn("SECRET_ASSIGNMENT", entity_types)
        self.assertIn("IP_ADDRESS", entity_types)
        self.assertIn("URL", entity_types)
        self.assertIn("ADDRESS", scan_text("address: 221B Baker Street, London")[0].type)
        self.assertIn("GITHUB_TOKEN", entity_types)
        self.assertIn("SLACK_TOKEN", entity_types)

    def test_mixed_code_keeps_normal_identifiers(self):
        text = "const user_profile_table = 'users'; const password = supersecret123;"

        result = scan_prompt_text(text)

        self.assertIn("user_profile_table", result.masked_text)
        self.assertIn("[PASSWORD_REDACTED]", result.masked_text)
        self.assertEqual(result.layers[0]["name"], "layer_1_normal_masking")
        self.assertGreaterEqual(result.layers[0]["detection_count"], 1)

    def test_sql_identifier_person_false_positives_are_not_masked(self):
        text = (
            "CREATE FUNCTION [dbo].[ufn_GetEnvironmentType]() RETURNS VARCHAR(20) "
            "AS BEGIN IF (@@SERVERNAME IN ('SEUSCPHPRSQL1', 'SDRPPHPRSQL3') "
            "AND DB_NAME() LIKE 'P2PHPR') BEGIN RETURN 'PRODUCTION' END "
            "RETURN CASE DB_NAME() WHEN 'P2PHDV' THEN 'DEVELOPMENT' END END"
        )

        with patch("app.pipeline.scan_with_presidio", return_value=[
            RawDetection("PERSON", "dbo", 17, 20, "medium", 0.86),
            RawDetection("PERSON", "ufn_GetEnvironmentType", 23, 45, "medium", 0.86),
            RawDetection("PERSON", "SEUSCPHPRSQL1", 82, 95, "medium", 0.86),
        ]):
            result = scan_prompt_text(text)

        self.assertNotIn("Person_001", result.masked_text)
        self.assertIn("ufn_GetEnvironmentType", result.masked_text)
        self.assertIn("SEUSCPHPRSQL1", result.masked_text)

    def test_layer_one_normal_masking_uses_extension_style_rules(self):
        text = 'const config = {"api_key": "abc1234567890xyza"}; email me@test.com'

        detections = scan_normal_masking(text)
        entity_types = {item.type for item in detections}

        self.assertIn("JSON_SECRET", entity_types)
        self.assertIn("EMAIL", entity_types)

    def test_env_style_password_is_detected_in_layer_one(self):
        text = "EMAIL_PASSWORD=myemailpassword"

        detections = scan_normal_masking(text)
        result = scan_prompt_text(text)

        self.assertEqual(detections[0].type, "PASSWORD_ASSIGNMENT")
        self.assertEqual(detections[0].value, "myemailpassword")
        self.assertEqual(result.masked_text, "EMAIL_PASSWORD=[PASSWORD_REDACTED]")
        self.assertEqual(result.layers[0]["detection_count"], 1)

    def test_presidio_locations_are_not_masked(self):
        text = "Alice Johnson lives in Mumbai and uses alice@example.com."

        with patch("app.pipeline.scan_with_presidio", return_value=[
            RawDetection("PERSON", "Alice Johnson", 0, 13, "medium", 0.9),
            RawDetection("LOCATION", "Mumbai", 23, 29, "medium", 0.86),
        ]):
            result = scan_prompt_text(text)

        self.assertIn("Person_001", result.masked_text)
        self.assertIn("Mumbai", result.masked_text)
        self.assertNotIn("Location_001", result.masked_text)
        self.assertIn("user_001@example.test", result.masked_text)
        self.assertEqual(result.action, "mask")
        self.assertEqual(result.layers[1]["name"], "layer_2_presidio_spacy")
        self.assertEqual(result.layers[1]["detection_count"], 1)

    def test_addresses_are_anonymized(self):
        text = "Ship to address: 221B Baker Street, London before noon."

        result = scan_prompt_text(text)

        self.assertIn("Address_001", result.masked_text)
        self.assertNotIn("221B Baker Street", result.masked_text)

    def test_lives_at_address_is_anonymized_without_masking_locations(self):
        text = (
            "Rahul Sharma, a 28-year-old software engineer from Hyderabad, recently moved "
            "to Bengaluru for work. He lives at 42 Green Park Avenue, Indiranagar, and "
            "often orders food online using his phone number, 98765 43210. His email "
            "address is rahul.sharma92@example.com. He is planning a vacation to Goa."
        )

        result = scan_prompt_text(text)

        self.assertIn("Address_001", result.masked_text)
        self.assertNotIn("42 Green Park Avenue", result.masked_text)
        self.assertIn("Hyderabad", result.masked_text)
        self.assertIn("Bengaluru", result.masked_text)
        self.assertIn("Goa", result.masked_text)
        self.assertIn("+91 9000000001", result.masked_text)
        self.assertIn("user_001@example.test", result.masked_text)

    def test_repeated_pii_uses_stable_replacements(self):
        text = "Alice Johnson emailed alice@example.com. Alice Johnson owns alice@example.com."

        with patch("app.pipeline.scan_with_presidio", return_value=[
            RawDetection("PERSON", "Alice Johnson", 0, 13, "medium", 0.9),
            RawDetection("PERSON", "Alice Johnson", 40, 53, "medium", 0.9),
        ]):
            result = scan_prompt_text(text)

        self.assertEqual(result.masked_text.count("Person_001"), 2)
        self.assertEqual(result.masked_text.count("user_001@example.test"), 2)

    def test_json_remains_parseable_after_masking(self):
        text = '{"email":"alice@example.com","password":"hello123","url":"https://internal.example.com/a"}'

        result = scan_prompt_text(text)
        parsed = json.loads(result.masked_text)

        self.assertEqual(parsed["email"], "user_001@example.test")
        self.assertEqual(parsed["password"], "[PASSWORD_REDACTED]")
        self.assertTrue(parsed["url"].startswith("https://example.test/"))

    def test_sql_quotes_are_preserved(self):
        text = "UPDATE users SET email = 'alice@example.com', password = 'hello123' WHERE customer_id = 'CUST-1';"

        result = scan_prompt_text(text)

        self.assertIn("email = 'user_001@example.test'", result.masked_text)
        self.assertIn("password = '[PASSWORD_REDACTED]'", result.masked_text)
        self.assertIn("customer_id = 'ID_001'", result.masked_text)

    def test_critical_secrets_use_typed_redaction(self):
        text = "key=sk-1234567890abcdefghijklmnop auth=Bearer abcdefghijklmnopqrstuvwxyz1234567890"

        result = scan_prompt_text(text)

        self.assertIn("[OPENAI_API_KEY_REDACTED]", result.masked_text)
        self.assertIn("Bearer [TOKEN_REDACTED]", result.masked_text)
        self.assertNotIn("sk-safe", result.masked_text)

    def test_chunking_uses_overlap(self):
        chunks = chunk_text("a" * 6500, size=3000, overlap=200)

        self.assertEqual(chunks[0].start, 0)
        self.assertEqual(chunks[1].start, 2800)
        self.assertEqual(chunks[2].start, 5600)

    def test_presidio_chunk_offsets_map_to_original_text(self):
        text = ("x" * 3100) + "Alice Johnson" + ("y" * 200)

        with patch("app.presidio_detector._get_analyzer", return_value=FakeAnalyzer()):
            detections = scan_with_presidio(text)

        person = next(item for item in detections if item.type == "PERSON")
        self.assertEqual(person.start, 3100)
        self.assertEqual(person.end, 3113)
        self.assertEqual(person.value, "Alice Johnson")

    def test_overlapping_detections_are_deduped_once(self):
        text = "email user@example.com"
        regex_detection = scan_text(text)[0]
        weaker_presidio_detection = RawDetection(
            "EMAIL",
            "user@example.com",
            regex_detection.start,
            regex_detection.end,
            "medium",
            0.5,
        )

        detections = dedupe_overlaps([weaker_presidio_detection, regex_detection])

        self.assertEqual(len(detections), 1)
        self.assertEqual(detections[0].confidence, regex_detection.confidence)

    def test_presidio_missing_model_falls_back_to_empty_results(self):
        with patch("app.presidio_detector._get_analyzer", return_value=None):
            detections = scan_with_presidio("Alice Johnson")

        self.assertEqual(detections, [])

    def test_api_scan_function_returns_compatible_response(self):
        response = scan_prompt(ScanRequest(text="email test@example.com password=hello123"))

        self.assertTrue(response.success)
        self.assertEqual(response.action, "mask")
        self.assertGreaterEqual(response.detection_count, 2)
        self.assertIn("user_001@example.test", response.masked_text)
        self.assertIn("[PASSWORD_REDACTED]", response.masked_text)
        self.assertEqual(response.layers[0].name, "layer_1_normal_masking")
        self.assertEqual(response.layers[1].name, "layer_2_presidio_spacy")


if __name__ == "__main__":
    unittest.main()
