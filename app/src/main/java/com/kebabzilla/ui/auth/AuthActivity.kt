package com.kebabzilla.ui.auth

import android.os.Bundle
import android.os.CountDownTimer
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import com.kebabzilla.R
import com.kebabzilla.data.api.ApiClient
import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.databinding.ActivityAuthBinding
import com.kebabzilla.utils.Constants
import kotlinx.coroutines.launch

class AuthActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAuthBinding
    private lateinit var apiClient: ApiClient
    private lateinit var googleSignInClient: GoogleSignInClient
    private var isRegisterMode = false

    private var isEmailVerified = false
    private var verifiedEmailAddress: String? = null
    private var resendTimer: CountDownTimer? = null

    // 2-Step Verification for Staff & Admin
    private var activeTwoFactorToken: String? = null
    private var activeTwoFactorEmail: String? = null
    private var activeTwoFactorRole: String? = null
    private var activeLoginPassword: String? = null
    private var twoFactorResendTimer: CountDownTimer? = null

    private val googleSignInLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
        try {
            val account = task.getResult(ApiException::class.java)
            val idToken = account?.idToken
            if (!idToken.isNullOrBlank()) {
                performGoogleLogin(idToken)
            } else {
                Toast.makeText(this, "Google token was empty. Please try again.", Toast.LENGTH_SHORT).show()
            }
        } catch (e: ApiException) {
            if (e.statusCode != 12501) { // 12501 is user cancelled
                Toast.makeText(this, "Google sign-in error: ${e.statusCode} ${e.localizedMessage ?: ""}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        binding = ActivityAuthBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { _, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            binding.root.setPadding(0, systemBars.top, 0, systemBars.bottom)
            insets
        }

        apiClient = ApiClient(this)
        setupGoogleSignIn()
        setupListeners()
        setupEmailVerificationListeners()
        updateMode(false)
    }

    override fun onDestroy() {
        super.onDestroy()
        resendTimer?.cancel()
        twoFactorResendTimer?.cancel()
    }

    private fun setupGoogleSignIn() {
        val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(Constants.GOOGLE_CLIENT_ID)
            .requestEmail()
            .build()
        googleSignInClient = GoogleSignIn.getClient(this, gso)
    }

    private fun setupListeners() {
        binding.btnAuthBack.setOnClickListener {
            if (binding.layoutTwoFactorAuth.visibility == View.VISIBLE) {
                hideTwoFactorUi()
            } else {
                finish()
            }
        }

        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (binding.layoutTwoFactorAuth.visibility == View.VISIBLE) {
                    hideTwoFactorUi()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        binding.tabSignIn.setOnClickListener {
            updateMode(false)
        }

        binding.tabRegister.setOnClickListener {
            updateMode(true)
        }

        binding.btnGoogleSignIn.setOnClickListener {
            googleSignInClient.signOut().addOnCompleteListener {
                val signInIntent = googleSignInClient.signInIntent
                googleSignInLauncher.launch(signInIntent)
            }
        }

        binding.btnGuestExplore.setOnClickListener {
            finish()
        }

        binding.btnForgotPassword.setOnClickListener {
            showForgotPasswordDialog()
        }

        binding.btnAuthSubmit.setOnClickListener {
            if (isRegisterMode) {
                performRegister()
            } else {
                performLogin()
            }
        }

        binding.btnTwoFactorSubmit.setOnClickListener {
            performTwoFactorVerification()
        }

        binding.btnTwoFactorCancel.setOnClickListener {
            hideTwoFactorUi()
        }

        binding.btnTwoFactorResend.setOnClickListener {
            resendTwoFactorOtp()
        }

        binding.etTwoFactorOtp.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                val code = s?.toString()?.trim().orEmpty()
                if (code.length == 6) {
                    performTwoFactorVerification()
                }
            }
            override fun afterTextChanged(s: Editable?) {}
        })
    }

    private fun setupEmailVerificationListeners() {
        binding.etAuthEmail.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                val currentEmail = s?.toString()?.trim().orEmpty()
                if (isRegisterMode) {
                    if (isEmailVerified && currentEmail.equals(verifiedEmailAddress, ignoreCase = true)) {
                        binding.btnVerifyEmailInline.visibility = View.GONE
                        binding.layoutEmailVerifiedBadge.visibility = View.VISIBLE
                        binding.cardEmailOtp.visibility = View.GONE
                    } else {
                        isEmailVerified = false
                        binding.layoutEmailVerifiedBadge.visibility = View.GONE
                        val isValid = isValidEmail(currentEmail)
                        binding.btnVerifyEmailInline.visibility = if (isValid) View.VISIBLE else View.GONE
                    }
                }
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        binding.btnVerifyEmailInline.setOnClickListener {
            val email = binding.etAuthEmail.text?.toString()?.trim().orEmpty()
            if (!isValidEmail(email)) {
                Toast.makeText(this, "Please enter a valid email address", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            sendEmailVerificationOtp(email)
        }

        binding.btnSubmitOtp.setOnClickListener {
            val email = binding.etAuthEmail.text?.toString()?.trim().orEmpty()
            val otp = binding.etEmailOtp.text?.toString()?.trim().orEmpty()
            if (otp.length != 6) {
                Toast.makeText(this, "Please enter a 6-digit verification code", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            verifyEmailOtp(email, otp)
        }

        binding.btnResendOtp.setOnClickListener {
            val email = binding.etAuthEmail.text?.toString()?.trim().orEmpty()
            if (isValidEmail(email)) {
                sendEmailVerificationOtp(email)
            }
        }
    }

    private fun isValidEmail(email: String): Boolean {
        return android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()
    }

    private fun sendEmailVerificationOtp(email: String) {
        setLoading(true)
        lifecycleScope.launch {
            // First check if email is already taken
            val check = apiClient.checkEmailAvailable(email)
            if (check is NetworkResult.Success && !check.data) {
                setLoading(false)
                Toast.makeText(this@AuthActivity, "An account with this email already exists.", Toast.LENGTH_LONG).show()
                return@launch
            }

            val result = apiClient.sendVerificationOtp(email, "REGISTER")
            setLoading(false)
            when (result) {
                is NetworkResult.Success -> {
                    Toast.makeText(this@AuthActivity, result.data, Toast.LENGTH_SHORT).show()
                    binding.cardEmailOtp.visibility = View.VISIBLE
                    binding.btnVerifyEmailInline.visibility = View.GONE
                    binding.etEmailOtp.setText("")
                    binding.etEmailOtp.requestFocus()
                    startResendCountdown()
                }
                is NetworkResult.Error -> {
                    Toast.makeText(this@AuthActivity, result.message, Toast.LENGTH_LONG).show()
                }
                is NetworkResult.Loading -> {}
            }
        }
    }

    private fun verifyEmailOtp(email: String, otp: String) {
        setLoading(true)
        lifecycleScope.launch {
            val result = apiClient.verifyEmailOtp(email, otp, "REGISTER")
            setLoading(false)
            when (result) {
                is NetworkResult.Success -> {
                    if (result.data) {
                        isEmailVerified = true
                        verifiedEmailAddress = email
                        binding.cardEmailOtp.visibility = View.GONE
                        binding.btnVerifyEmailInline.visibility = View.GONE
                        binding.layoutEmailVerifiedBadge.visibility = View.VISIBLE
                        resendTimer?.cancel()
                        Toast.makeText(this@AuthActivity, "Email verified successfully!", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(this@AuthActivity, "Invalid OTP code. Please try again.", Toast.LENGTH_SHORT).show()
                    }
                }
                is NetworkResult.Error -> {
                    Toast.makeText(this@AuthActivity, result.message, Toast.LENGTH_LONG).show()
                }
                is NetworkResult.Loading -> {}
            }
        }
    }

    private fun startResendCountdown() {
        resendTimer?.cancel()
        binding.btnResendOtp.isEnabled = false
        binding.btnResendOtp.alpha = 0.5f

        resendTimer = object : CountDownTimer(30000, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                val seconds = millisUntilFinished / 1000
                binding.tvOtpResendNotice.text = "Resend available in ${seconds}s"
            }

            override fun onFinish() {
                binding.tvOtpResendNotice.text = "Didn't receive code?"
                binding.btnResendOtp.isEnabled = true
                binding.btnResendOtp.alpha = 1.0f
            }
        }.start()
    }

    private fun updateMode(register: Boolean) {
        isRegisterMode = register
        if (register) {
            binding.tabSignIn.setBackgroundResource(R.drawable.bg_category_chip_unselected)
            binding.tabSignIn.setTextColor(getColor(R.color.brand_muted))
            binding.tabRegister.setBackgroundResource(R.drawable.bg_category_chip_selected)
            binding.tabRegister.setTextColor(getColor(R.color.white))

            binding.tvAuthTitle.text = "Create Your Account"
            binding.tvAuthSubtitle.text = "Join KebabZilla to experience authentic charcoal grilling"
            binding.tilName.visibility = View.VISIBLE
            binding.tilPhone.visibility = View.VISIBLE
            binding.tilConfirmPassword.visibility = View.VISIBLE
            binding.cbPromoConsent.visibility = View.VISIBLE
            binding.layoutForgotPassword.visibility = View.GONE
            binding.btnAuthSubmit.text = "Create Account"
            binding.btnGoogleSignIn.text = "Sign up with Google"

            val email = binding.etAuthEmail.text?.toString()?.trim().orEmpty()
            if (isEmailVerified && email.equals(verifiedEmailAddress, ignoreCase = true)) {
                binding.btnVerifyEmailInline.visibility = View.GONE
                binding.layoutEmailVerifiedBadge.visibility = View.VISIBLE
            } else {
                binding.layoutEmailVerifiedBadge.visibility = View.GONE
                binding.btnVerifyEmailInline.visibility = if (isValidEmail(email)) View.VISIBLE else View.GONE
            }
        } else {
            binding.tabSignIn.setBackgroundResource(R.drawable.bg_category_chip_selected)
            binding.tabSignIn.setTextColor(getColor(R.color.white))
            binding.tabRegister.setBackgroundResource(R.drawable.bg_category_chip_unselected)
            binding.tabRegister.setTextColor(getColor(R.color.brand_muted))

            binding.tvAuthTitle.text = "Welcome Back"
            binding.tvAuthSubtitle.text = "Sign in to enjoy delicious charcoal grilled kebabs & rolls"
            binding.tilName.visibility = View.GONE
            binding.tilPhone.visibility = View.GONE
            binding.tilConfirmPassword.visibility = View.GONE
            binding.cbPromoConsent.visibility = View.GONE
            binding.cardEmailOtp.visibility = View.GONE
            binding.btnVerifyEmailInline.visibility = View.GONE
            binding.layoutEmailVerifiedBadge.visibility = View.GONE
            binding.layoutForgotPassword.visibility = View.VISIBLE
            binding.btnAuthSubmit.text = "Sign In"
            binding.btnGoogleSignIn.text = "Sign in with Google"
        }
    }

    private fun showForgotPasswordDialog() {
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_variation_picker, null)
        // We can create a simple dynamic alert dialog with Material styling
        val context = this
        val layout = android.widget.LinearLayout(context).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(60, 30, 60, 20)
        }

        val til = TextInputLayout(context).apply {
            hint = "Enter registered email"
            setBoxStrokeColor(getColor(R.color.brand_red))
        }
        val et = TextInputEditText(context).apply {
            inputType = android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            val current = binding.etAuthEmail.text?.toString()?.trim().orEmpty()
            if (isValidEmail(current)) setText(current)
        }
        til.addView(et)
        layout.addView(til)

        MaterialAlertDialogBuilder(this)
            .setTitle("Reset Password")
            .setMessage("We will send password reset instructions to your registered email.")
            .setView(layout)
            .setPositiveButton("Send Reset Link") { _, _ ->
                val email = et.text?.toString()?.trim().orEmpty()
                if (!isValidEmail(email)) {
                    Toast.makeText(this, "Please enter a valid email", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                setLoading(true)
                lifecycleScope.launch {
                    val result = apiClient.forgotPassword(email)
                    setLoading(false)
                    when (result) {
                        is NetworkResult.Success -> {
                            Toast.makeText(this@AuthActivity, result.data, Toast.LENGTH_LONG).show()
                        }
                        is NetworkResult.Error -> {
                            Toast.makeText(this@AuthActivity, result.message, Toast.LENGTH_LONG).show()
                        }
                        is NetworkResult.Loading -> {}
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun performGoogleLogin(idToken: String) {
        setLoading(true)
        lifecycleScope.launch {
            val result = apiClient.googleLogin(idToken)
            setLoading(false)
            when (result) {
                is NetworkResult.Success -> {
                    if (result.data.requires2Fa && !result.data.tempToken.isNullOrBlank()) {
                        showTwoFactorUi(
                            tempToken = result.data.tempToken,
                            email = result.data.email.orEmpty(),
                            role = result.data.role.orEmpty(),
                            password = null
                        )
                    } else if (result.data.user != null) {
                        com.kebabzilla.data.local.CartManager.syncFromRemote()
                        Toast.makeText(this@AuthActivity, "Signed in as ${result.data.user.name}", Toast.LENGTH_SHORT).show()
                        setResult(RESULT_OK)
                        finish()
                    }
                }
                is NetworkResult.Error -> {
                    Toast.makeText(this@AuthActivity, result.message, Toast.LENGTH_LONG).show()
                }
                is NetworkResult.Loading -> {}
            }
        }
    }

    private fun performLogin() {
        val email = binding.etAuthEmail.text?.toString()?.trim().orEmpty()
        val password = binding.etAuthPassword.text?.toString().orEmpty()

        if (email.isBlank() || password.isBlank()) {
            Toast.makeText(this, "Please enter your email and password", Toast.LENGTH_SHORT).show()
            return
        }

        setLoading(true)
        lifecycleScope.launch {
            val result = apiClient.login(email, password)
            setLoading(false)
            when (result) {
                is NetworkResult.Success -> {
                    if (result.data.requires2Fa && !result.data.tempToken.isNullOrBlank()) {
                        showTwoFactorUi(
                            tempToken = result.data.tempToken,
                            email = result.data.email ?: email,
                            role = result.data.role.orEmpty(),
                            password = password
                        )
                    } else if (result.data.user != null) {
                        com.kebabzilla.data.local.CartManager.syncFromRemote()
                        Toast.makeText(this@AuthActivity, "Welcome back, ${result.data.user.name}!", Toast.LENGTH_SHORT).show()
                        setResult(RESULT_OK)
                        finish()
                    }
                }
                is NetworkResult.Error -> {
                    Toast.makeText(this@AuthActivity, result.message, Toast.LENGTH_LONG).show()
                }
                is NetworkResult.Loading -> {}
            }
        }
    }

    private fun showTwoFactorUi(tempToken: String, email: String, role: String, password: String?) {
        activeTwoFactorToken = tempToken
        activeTwoFactorEmail = email
        activeTwoFactorRole = role
        activeLoginPassword = password

        binding.layoutStandardAuth.visibility = View.GONE
        binding.layoutTwoFactorAuth.visibility = View.VISIBLE

        val roleUpper = role.uppercase()
        val roleLabel = when {
            roleUpper.contains("ADMIN") -> "ADMIN"
            roleUpper.contains("DELIVERY") || roleUpper.contains("RIDER") -> "DELIVERY"
            else -> "STAFF"
        }
        binding.tvTwoFactorEyebrow.text = "$roleLabel SECURITY VERIFICATION"

        val instructionText = if (email.isNotBlank()) {
            "A 6-digit security code was dispatched to $email. Enter it below to complete sign-in to your $roleLabel workspace."
        } else {
            "A 6-digit security code was dispatched to your email. Enter it below to complete sign-in to your $roleLabel workspace."
        }
        binding.tvTwoFactorInstruction.text = instructionText

        binding.etTwoFactorOtp.setText("")
        binding.etTwoFactorOtp.requestFocus()
        startTwoFactorResendCountdown()
    }

    private fun hideTwoFactorUi() {
        activeTwoFactorToken = null
        activeTwoFactorEmail = null
        activeTwoFactorRole = null
        activeLoginPassword = null
        twoFactorResendTimer?.cancel()

        binding.layoutTwoFactorAuth.visibility = View.GONE
        binding.layoutStandardAuth.visibility = View.VISIBLE
        binding.etTwoFactorOtp.setText("")
    }

    private fun performTwoFactorVerification() {
        val tempToken = activeTwoFactorToken
        if (tempToken.isNullOrBlank()) {
            Toast.makeText(this, "Verification session expired. Please sign in again.", Toast.LENGTH_SHORT).show()
            hideTwoFactorUi()
            return
        }

        val code = binding.etTwoFactorOtp.text?.toString()?.trim().orEmpty()
        if (code.length != 6) {
            Toast.makeText(this, "Please enter a 6-digit verification code", Toast.LENGTH_SHORT).show()
            return
        }

        setLoading(true)
        lifecycleScope.launch {
            val result = apiClient.verify2fa(tempToken, code)
            setLoading(false)
            when (result) {
                is NetworkResult.Success -> {
                    com.kebabzilla.data.local.CartManager.syncFromRemote()
                    val userName = result.data.user?.name ?: "Staff Member"
                    Toast.makeText(this@AuthActivity, "Welcome back, $userName!", Toast.LENGTH_SHORT).show()
                    setResult(RESULT_OK)
                    finish()
                }
                is NetworkResult.Error -> {
                    Toast.makeText(this@AuthActivity, result.message, Toast.LENGTH_LONG).show()
                }
                is NetworkResult.Loading -> {}
            }
        }
    }

    private fun startTwoFactorResendCountdown() {
        twoFactorResendTimer?.cancel()
        binding.btnTwoFactorResend.isEnabled = false
        binding.btnTwoFactorResend.alpha = 0.5f

        twoFactorResendTimer = object : CountDownTimer(30000, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                val seconds = millisUntilFinished / 1000
                binding.tvTwoFactorResendNotice.text = "Resend available in ${seconds}s"
            }

            override fun onFinish() {
                binding.tvTwoFactorResendNotice.text = "Didn't receive code?"
                binding.btnTwoFactorResend.isEnabled = true
                binding.btnTwoFactorResend.alpha = 1.0f
            }
        }.start()
    }

    private fun resendTwoFactorOtp() {
        val email = activeTwoFactorEmail
        val pwd = activeLoginPassword
        if (email.isNullOrBlank() || pwd.isNullOrBlank()) {
            Toast.makeText(this, "Please sign in again to request a new verification code.", Toast.LENGTH_SHORT).show()
            hideTwoFactorUi()
            return
        }

        setLoading(true)
        lifecycleScope.launch {
            val result = apiClient.login(email, pwd)
            setLoading(false)
            when (result) {
                is NetworkResult.Success -> {
                    if (result.data.requires2Fa && !result.data.tempToken.isNullOrBlank()) {
                        activeTwoFactorToken = result.data.tempToken
                        Toast.makeText(this@AuthActivity, "New 6-digit security code sent to $email", Toast.LENGTH_SHORT).show()
                        startTwoFactorResendCountdown()
                    } else if (result.data.user != null) {
                        com.kebabzilla.data.local.CartManager.syncFromRemote()
                        Toast.makeText(this@AuthActivity, "Welcome back, ${result.data.user.name}!", Toast.LENGTH_SHORT).show()
                        setResult(RESULT_OK)
                        finish()
                    }
                }
                is NetworkResult.Error -> {
                    Toast.makeText(this@AuthActivity, result.message, Toast.LENGTH_LONG).show()
                }
                is NetworkResult.Loading -> {}
            }
        }
    }

    private fun performRegister() {
        val name = binding.etAuthName.text?.toString()?.trim().orEmpty()
        val email = binding.etAuthEmail.text?.toString()?.trim().orEmpty()
        val rawPhone = binding.etAuthPhone.text?.toString()?.trim().orEmpty()
        val password = binding.etAuthPassword.text?.toString().orEmpty()
        val confirmPassword = binding.etAuthConfirmPassword.text?.toString().orEmpty()
        val promoConsent = binding.cbPromoConsent.isChecked

        if (name.isBlank() || email.isBlank() || password.isBlank()) {
            Toast.makeText(this, "Please fill in all required fields", Toast.LENGTH_SHORT).show()
            return
        }

        if (password != confirmPassword) {
            Toast.makeText(this, "Passwords do not match", Toast.LENGTH_SHORT).show()
            return
        }

        if (password.length < 6) {
            Toast.makeText(this, "Password must be at least 6 characters", Toast.LENGTH_SHORT).show()
            return
        }

        if (!isEmailVerified || !email.equals(verifiedEmailAddress, ignoreCase = true)) {
            Toast.makeText(this, "Please verify your email with OTP before registering", Toast.LENGTH_LONG).show()
            binding.btnVerifyEmailInline.visibility = View.VISIBLE
            return
        }

        val formattedPhone = if (rawPhone.isNotBlank()) {
            val digits = rawPhone.filter { it.isDigit() }
            if (digits.length != 10) {
                Toast.makeText(this, "Please enter a valid 10-digit mobile number", Toast.LENGTH_SHORT).show()
                return
            }
            "+91$digits"
        } else null

        setLoading(true)
        lifecycleScope.launch {
            val result = apiClient.register(name, email, formattedPhone, password, promoConsent)
            setLoading(false)
            when (result) {
                is NetworkResult.Success -> {
                    com.kebabzilla.data.local.CartManager.syncFromRemote()
                    val userName = result.data.user?.name ?: "User"
                    Toast.makeText(this@AuthActivity, "Account created successfully! Welcome, $userName", Toast.LENGTH_SHORT).show()
                    setResult(RESULT_OK)
                    finish()
                }
                is NetworkResult.Error -> {
                    Toast.makeText(this@AuthActivity, result.message, Toast.LENGTH_LONG).show()
                }
                is NetworkResult.Loading -> {}
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        binding.pbAuth.visibility = if (loading) View.VISIBLE else View.GONE
        binding.btnAuthSubmit.isEnabled = !loading
        binding.btnGoogleSignIn.isEnabled = !loading
        binding.btnTwoFactorSubmit.isEnabled = !loading
        binding.btnTwoFactorCancel.isEnabled = !loading
    }
}
