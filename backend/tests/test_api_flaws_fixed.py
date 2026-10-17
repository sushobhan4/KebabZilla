import unittest
from pydantic import ValidationError
from app.schemas import OrderLineInput, CartItemInput, CustomizationOptionInput, OrderCreate
from app.models import Role


class TestApiFlawsFixed(unittest.TestCase):
    def test_customization_rejects_negative_extra_paise(self):
        """Verify that negative extra_paise is rejected by schema validation."""
        with self.assertRaises(ValidationError):
            CustomizationOptionInput(name="Discount", extra_paise=-500)

        with self.assertRaises(ValidationError):
            OrderLineInput(
                menu_item_id=1,
                quantity=1,
                customizations=[{"name": "Discount", "extra_paise": -500}],
            )

        with self.assertRaises(ValidationError):
            CartItemInput(
                menu_id=1,
                quantity=1,
                customizations=[{"name": "Discount", "extra_paise": -100}],
            )

    def test_customization_accepts_valid_options(self):
        """Verify valid customization options are parsed and preserved."""
        item = OrderLineInput(
            menu_item_id=1,
            quantity=2,
            customizations=[{"name": "Extra Mayo", "extra_paise": 1500}],
        )
        self.assertEqual(len(item.customizations), 1)
        self.assertEqual(item.customizations[0].name, "Extra Mayo")
        self.assertEqual(item.customizations[0].extra_paise, 1500)

    def test_order_create_notes_bounded(self):
        """Verify order notes length is constrained."""
        long_notes = "A" * 501
        with self.assertRaises(ValidationError):
            OrderCreate(
                items=[OrderLineInput(menu_item_id=1, quantity=1)],
                payment_method="CASH",
                notes=long_notes,
            )


    def test_order_payload_masks_customer_email_for_delivery(self):
        """Verify delivery riders do not receive customer email in order payloads."""
        from unittest.mock import MagicMock
        from app.services import order_payload
        from app.models import OrderStatus

        mock_customer = MagicMock(name="Test Customer", email="private.customer@example.com", phone="+919876543210", addresses=[])
        mock_customer.name = "Test Customer"
        mock_order = MagicMock(
            order_id="ORD-101",
            customer_id=1,
            customer=mock_customer,
            delivery=None,
            payment=None,
            items=[],
            address="Test Address",
            latitude=22.5,
            longitude=88.3,
            delivery_fee_paise=0,
            status=OrderStatus.PLACED,
            order_type="DELIVERY",
            scheduled_for=None,
            notes="",
            assigned_delivery_id=None,
            created_at=None,
            delivery_started_at=None,
            delivered_at=None,
            customer_name=None,
            customer_phone=None,
        )

        # Standard payload includes customer email
        customer_payload = order_payload(mock_order, include_customer_email=True)
        self.assertEqual(customer_payload["customer_email"], "private.customer@example.com")

        # Delivery partner payload omits customer email
        delivery_payload = order_payload(mock_order, include_customer_email=False)
        self.assertEqual(delivery_payload["customer_email"], "")

    def test_cart_customer_only_permits_user_and_admin(self):
        """Verify cart allows USER and ADMIN but forbids other roles."""
        from unittest.mock import MagicMock
        from fastapi import HTTPException
        from app.routers.cart import customer_only

        user_acc = MagicMock(role=Role.USER)
        admin_acc = MagicMock(role=Role.ADMIN)
        employee_acc = MagicMock(role=Role.EMPLOYEE)
        delivery_acc = MagicMock(role=Role.DELIVERY)

        # Should not raise for USER or ADMIN
        customer_only(user_acc)
        customer_only(admin_acc)

        # Should raise 403 for EMPLOYEE or DELIVERY
        with self.assertRaises(HTTPException) as ctx:
            customer_only(employee_acc)
        self.assertEqual(ctx.exception.status_code, 403)

        with self.assertRaises(HTTPException) as ctx:
            customer_only(delivery_acc)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_delivery_available_orders_checks_duty_status(self):
        """Verify off-duty delivery partner receives empty available orders."""
        from unittest.mock import MagicMock
        from app.routers.delivery import available_orders

        off_duty_rider = MagicMock(role=Role.DELIVERY, is_accepting_deliveries=False)
        mock_db = MagicMock()

        res = available_orders(account=off_duty_rider, db=mock_db)
        self.assertEqual(res, [])
        mock_db.scalars.assert_not_called()

    def test_menu_categories_has_no_admin_restriction(self):
        """Verify GET /menu/categories is public and not locked behind ADMIN role."""
        from app.routers.menu import router
        for route in router.routes:
            if getattr(route, "path", None) == "/categories" and "GET" in route.methods:
                self.assertEqual(len(route.dependencies), 0)


if __name__ == "__main__":
    unittest.main()

