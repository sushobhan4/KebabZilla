import unittest
from app.email_templates import (
    render_otp_email,
    render_offer_email,
    render_account_created_email,
    render_temporary_password_email,
)
from app.storage import upload_email_image, get_email_image_blob


class TestEmailTemplates(unittest.TestCase):
    def test_render_otp_email(self):
        html = render_otp_email(otp="123456", name="John", purpose="password_reset")
        self.assertIn("1", html)
        self.assertIn("2", html)
        self.assertIn("3", html)
        self.assertIn("Code Requested", html)
        self.assertNotIn("Copy OTP Code", html)
        self.assertNotIn("copy-otp?code=123456", html)
        self.assertIn("KebabZilla", html)
        self.assertIn("Serambhi Ramadhan", html)
        self.assertIn("Slopes", html)
        self.assertIn("Password Reset Code", html)
        self.assertIn("support@kebabzilla.in", html)
        self.assertIn("blur(150px)", html)

    def test_render_staff_2fa_otp(self):
        html = render_otp_email(otp="654321", name="Admin", purpose="staff_2fa")
        self.assertIn("6", html)
        self.assertIn("5", html)
        self.assertIn("Staff 2-Step Verification", html)
        self.assertNotIn("Copy OTP Code", html)
        self.assertNotIn("copy-otp", html)

    def test_render_offer_email_custom(self):
        html = render_offer_email(
            subject="Weekend Special",
            message="Get 20% off all kebabs this Saturday and Sunday!",
            headline="Sizzle into the Weekend!",
            subheading="Charcoal grilled magic",
            promo_code="WEEKEND20",
            discount_highlight="20% OFF",
            cta_text="Order Now",
            cta_url="https://kebabzilla.in/#menu",
            background_image_url="https://images.unsplash.com/test-kebab.jpg",
            theme_color="#FF5722",
        )
        self.assertIn("Sizzle into the Weekend!", html)
        self.assertIn("WEEKEND20", html)
        self.assertIn("20% OFF", html)
        self.assertIn("Apply &amp; Order", html)
        self.assertIn("Order Now", html)
        self.assertIn("https://images.unsplash.com/test-kebab.jpg", html)
        self.assertIn("#FF5722", html)
        self.assertIn("support@kebabzilla.in", html)
        self.assertNotIn("100% Halal", html)
        self.assertNotIn("Hot &amp; Fresh", html)

    def test_render_account_created_email(self):
        html = render_account_created_email(
            name="Chef Gordon",
            email="chef@kebabzilla.in",
            role="KITCHEN",
        )
        self.assertIn("Chef Gordon", html)
        self.assertIn("chef@kebabzilla.in", html)
        self.assertIn("KITCHEN", html)

    def test_render_temporary_password_email(self):
        html = render_temporary_password_email(
            name="Rider Dave",
            email="rider@kebabzilla.in",
            role="DELIVERY",
            temporary_password="TempPass123!",
        )
        self.assertIn("TempPass123!", html)
        self.assertNotIn("Copy Password", html)
        self.assertIn("Sign In &amp; Change Password", html)

    def test_upload_and_get_email_image(self):
        dummy_bytes = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 20
        result = upload_email_image(dummy_bytes, "test_banner.jpg", "image/jpeg")
        try:
            self.assertIn("filename", result)
            self.assertIn("url", result)
            self.assertIn("public_url", result)
            self.assertTrue(result["public_url"].endswith(f"/api/v1/public/email-images/{result['filename']}"))
            self.assertTrue(result["public_url"].startswith("http"))
            self.assertTrue(result["filename"].endswith(".jpg"))

            data, ctype = get_email_image_blob(result["filename"])
            self.assertEqual(data, dummy_bytes)
            self.assertEqual(ctype, "image/jpeg")
        finally:
            from app.storage import delete_email_image
            delete_email_image(result["filename"])

    def test_render_offer_email_invert_logo_and_opacity(self):
        html_normal = render_offer_email(
            subject="Normal Logo",
            message="Tasty feast",
            background_image_url="https://images.unsplash.com/photo-1555939594-58d7cb561ad1",
            invert_logo=False,
            background_opacity=0.5,
        )
        self.assertIn("kebabzilla-email-logo.png", html_normal)
        self.assertNotIn("kebabzilla-email-logo-dark.png", html_normal)
        self.assertIn("backdrop-filter: blur", html_normal)

        html_inverted = render_offer_email(
            subject="Inverted Logo",
            message="Tasty feast",
            background_image_url="https://images.unsplash.com/photo-1555939594-58d7cb561ad1",
            invert_logo=True,
            background_opacity=0.8,
        )
        self.assertIn("kebabzilla-email-logo-dark.png", html_inverted)

    def test_get_blurred_image_url(self):
        from app.image_utils import get_blurred_image_url
        unsplash = "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=1200&q=80"
        blurred_unsplash = get_blurred_image_url(unsplash, 20)
        self.assertIn("blur=20", blurred_unsplash)

        backend_img = "https://api.kebabzilla.in/api/v1/public/email-images/kebab.jpg"
        blurred_backend = get_blurred_image_url(backend_img, 70)
        self.assertIn("blur=70", blurred_backend)

        external_img = "https://images.example.com/banner.jpg"
        blurred_external = get_blurred_image_url(external_img, 50)
        self.assertIn("email-images-proxy", blurred_external)
        self.assertIn("blur=50", blurred_external)

    def test_otp_email_has_blurred_outer_and_sharp_inner(self):
        html = render_otp_email(otp="998877", name="Sushobhan", purpose="staff_2fa", outer_blur=20)
        self.assertIn("blur=20", html)
        # Inner card table has sharp unblurred URL
        self.assertIn("photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=1200&q=80", html)


if __name__ == "__main__":
    unittest.main()
