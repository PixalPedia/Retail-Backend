const nodemailer = require('nodemailer');
const { supabase, supabaseAdmin } = require('../supabaseClient'); // Import Supabase clients
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Helper to generate 6-digit OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Configure nodemailer for Gmail SMTP
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_ADDRESS,  // Gmail address
        pass: process.env.EMAIL_PASSWORD // Gmail app password
    },
});

// Function to send OTP via email
const sendOTPEmail = async (email, otp, purpose) => {
    const mailOptions = {
        from: process.env.EMAIL_ADDRESS,
        to: email,
        subject: `Your OTP for ${purpose}`, // Dynamic subject based on purpose
        html: `
           <div style="font-family: Arial, sans-serif; text-align: center; color: #333; padding: 30px;">
    <h1 style="font-size: 24px; margin-bottom: 20px;">Welcome to <strong>Lakshit's Test Site</strong>!</h1>
    
    <!-- OTP Container -->
    <div style="font-size: 32px; font-weight: bold; background-color: #eceff1; color: #000; padding: 15px; border: 1px solid #ddd; border-radius: 5px; display: inline-block; margin: 20px auto;">
        ${otp}
    </div>
    
    <p style="font-size: 16px; color: #666; margin: 20px;">Your verification code is <strong>valid for 10 minutes</strong>. Use it to continue with <strong>${purpose}</strong>.</p>
    
    <!-- Logo Section -->
    <div style="margin: 30px auto;">
        <img src="https://vrkxxjqualipkaicqorj.supabase.co/storage/v1/object/public/images/Logo%20lakshit.PNG" 
            alt="Company Logo" 
            style="max-width: 150px; height: auto; border-radius: 10px;" />
    </div>
    
    <p style="font-size: 14px; color: #666;">We appreciate your trust in <strong>Your Company Name</strong>. If you have any questions, feel free to contact us.</p>
    
    <!-- Footer -->
    <div style="font-size: 12px; color: #999; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 10px;">
        <p style="margin: 0;">Lakshit's Test Site. | Contact: Lakshitkhurana5678@gmail.com</p>
        <p style="margin: 0;">If you didn’t request this, please ignore this email.</p>
    </div>
</div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`OTP sent to ${email}`);
    } catch (error) {
        console.error('Error sending OTP email:', error.message);
        throw new Error('Failed to send OTP email');
    }
};

// Signup function
const signup = async (req, res) => {
    const { email, password, username } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress; // Get user's IP address

    try {
        // Basic input validation
        if (!email || !password || !username) {
            return res.status(400).json({ error: 'All fields are required.' });
        }

        // Validate email format
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Invalid email format.' });
        }

        // Validate password strength
        if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
            return res.status(400).json({
                error: 'Password must be at least 8 characters long and include letters and numbers.',
            });
        }

        const sanitizedEmail = email.trim().toLowerCase();
        const sanitizedUsername = username.trim();

        // Rate-limiting: Check previous attempts from the database
        const { data: signupData, error: signupError } = await supabase
            .from('signup_limits')
            .select('*')
            .eq('ip_address', ip)
            .eq('email', sanitizedEmail)
            .single();

        if (signupError && signupError.code !== 'PGRST116') throw signupError;

        if (signupData) {
            // Check if max attempts (5 per hour) have been exceeded
            const attemptsExceeded = signupData.attempts >= 5 && 
                Date.now() - new Date(signupData.last_attempt).getTime() < 60 * 60 * 1000;

            if (attemptsExceeded) {
                return res.status(429).json({
                    error: 'Too many signup attempts from this IP. Please try again later.',
                });
            }

            // Update signup attempts
            await supabase
                .from('signup_limits')
                .update({ 
                    attempts: signupData.attempts + 1, 
                    last_attempt: new Date() 
                })
                .eq('id', signupData.id);
        } else {
            // Insert a new record for signup attempts if it doesn't exist
            await supabase
                .from('signup_limits')
                .insert([{ 
                    ip_address: ip, 
                    email: sanitizedEmail, 
                    attempts: 1, 
                    last_attempt: new Date() 
                }]);
        }

        // Hash password securely
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user into the database
        const { data: userData, error: userError } = await supabase
            .from('users')
            .insert([{ email: sanitizedEmail, password: hashedPassword, username: sanitizedUsername }])
            .select();

        if (userError) throw userError;

        // Generate OTP for email verification
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes

        // Send OTP to user and store it securely in the database
        await sendOTPEmail(sanitizedEmail, otp, 'email verification');
        await supabase.from('otps').insert([{ email: sanitizedEmail, otp, purpose: 'email_verification', expires_at: expiresAt }]);

        // Respond with success
        res.status(201).json({
            message: 'Signup successful! Please verify your email using the OTP sent to your email.',
            user: {
                id: userData[0].id, // UUID or ID from the database
                email: sanitizedEmail,
                username: sanitizedUsername,
            },
        });
    } catch (err) {
        console.error('Signup Error:', err.message);
        res.status(500).json({ error: 'Signup failed.', details: err.message });
    }
};

const login = async (req, res) => {
    const { email, password } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress; // Capture user's IP address

    try {
        // Validate inputs
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        // Normalize the email
        const sanitizedEmail = email.trim().toLowerCase();

        // Fetch failed attempts from the database
        const { data: attemptRecord, error: attemptError } = await supabase
            .from('failed_login_attempts')
            .select('*')
            .eq('email', sanitizedEmail)
            .eq('ip_address', ip)
            .single();

        if (attemptError && attemptError.code !== 'PGRST116') throw attemptError;

        // Check if the account is temporarily locked
        if (attemptRecord && attemptRecord.failed_attempts >= 5 && new Date() < new Date(attemptRecord.locked_until)) {
            const lockRemaining = Math.ceil((new Date(attemptRecord.locked_until).getTime() - Date.now()) / 60000); // Minutes remaining
            return res.status(403).json({
                error: `Too many failed attempts. Account is locked. Try again after ${lockRemaining} minutes.`,
            });
        }

        // Fetch the user from the database
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, username, email, password') // Fetch only necessary fields
            .eq('email', sanitizedEmail)
            .single();

        if (userError || !user) {
            // Handle failed login attempt for invalid credentials
            const newFailedAttempts = attemptRecord ? attemptRecord.failed_attempts + 1 : 1;
            const lockUntil = newFailedAttempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null; // Lock for 30 minutes after 5 failed attempts

            if (attemptRecord) {
                // Update failed login attempts in the database
                await supabase.from('failed_login_attempts').update({
                    failed_attempts: newFailedAttempts,
                    locked_until: lockUntil,
                }).eq('email', sanitizedEmail).eq('ip_address', ip);
            } else {
                // Insert new failed login attempt record
                await supabase.from('failed_login_attempts').insert([{
                    email: sanitizedEmail,
                    ip_address: ip,
                    failed_attempts: 1,
                    locked_until: null,
                }]);
            }

            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Compare the provided password with the hashed password from the database
        const isPasswordCorrect = await bcrypt.compare(password, user.password);
        if (!isPasswordCorrect) {
            // Handle failed login attempt for incorrect password
            const newFailedAttempts = attemptRecord ? attemptRecord.failed_attempts + 1 : 1;
            const lockUntil = newFailedAttempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null; // Lock for 30 minutes after 5 failed attempts

            if (attemptRecord) {
                // Update failed login attempts in the database
                await supabase.from('failed_login_attempts').update({
                    failed_attempts: newFailedAttempts,
                    locked_until: lockUntil,
                }).eq('email', sanitizedEmail).eq('ip_address', ip);
            } else {
                // Insert new failed login attempt record
                await supabase.from('failed_login_attempts').insert([{
                    email: sanitizedEmail,
                    ip_address: ip,
                    failed_attempts: 1,
                    locked_until: null,
                }]);
            }

            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Reset failed attempts on successful login
        await supabase.from('failed_login_attempts').delete().match({ email: sanitizedEmail, ip_address: ip });

        // Generate JWT token for authentication
        const token = jwt.sign(
            { id: user.id, email: user.email, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '1h' } // Token expires in 1 hour
        );

        // Set the JWT as an HTTP-only cookie
        res.cookie('token', token, {
            httpOnly: true, // Prevent access via JavaScript
            secure: process.env.NODE_ENV === 'production', // Enable HTTPS in production
            sameSite: 'Strict', // Prevent CSRF attacks
            maxAge: 60 * 60 * 1000, // Expire after 1 hour
        });

        // Respond with user details (excluding token)
        res.status(200).json({
            message: 'Login successful.',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
            },
        });
    } catch (err) {
        console.error('Login Error:', err.message);
        res.status(500).json({ error: 'Login failed. Please try again.', details: err.message });
    }
};

// Verify Email with OTP
const verifyEmailWithOTP = async (req, res) => {
    const { email, otp } = req.body;

    try {
        // Normalize email to ensure case-insensitivity
        const sanitizedEmail = email.trim().toLowerCase();

        const { data: otpRecord, error } = await supabase
            .from('otps')
            .select('*')
            .eq('email', sanitizedEmail)
            .eq('otp', otp)
            .eq('purpose', 'email_verification')
            .single();

        if (!otpRecord || error) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        // Check if the OTP has expired
        if (new Date(otpRecord.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        // Mark the user as email verified
        const { error: updateError } = await supabase
            .from('users')
            .update({ is_email_verified: true })
            .eq('email', sanitizedEmail);

        if (updateError) throw updateError;

        res.status(200).json({ message: 'Email verified successfully!' });
    } catch (err) {
        res.status(500).json({ error: 'Verification failed', details: err.message });
    }
};

// Request OTP for password reset
// Request OTP for password reset
const requestOTPForPasswordReset = async (req, res) => {
  const { email } = req.body;

  try {
    const otp = generateOTP(); // Generate a new OTP
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
    console.log('Generated OTP and expiration time:', { otp, expiresAt });

    // Delete existing OTPs for the same email and purpose
    const { error: deleteError } = await supabase
      .from('otps')
      .delete()
      .match({ email, purpose: 'password_reset' });

    if (deleteError) {
      console.error('Error deleting existing OTPs:', deleteError.message);
      throw new Error('Failed to delete previous OTPs');
    }
    console.log('Old OTPs deleted successfully for:', email);

    // Insert the new OTP into the database
    const { error: insertError } = await supabase
      .from('otps')
      .insert([{ email, otp, purpose: 'password_reset', expires_at: expiresAt }]);

    if (insertError) {
      console.error('Error inserting new OTP:', insertError.message);
      throw new Error('Failed to insert new OTP');
    }
    console.log('New OTP inserted successfully for:', email);

    // Send the OTP email
    await sendOTPEmail(email, otp, 'password reset');
    console.log('OTP email sent successfully to:', email);

    res.status(200).json({ message: 'OTP sent for password reset. Please check your email.' });
  } catch (err) {
    console.error('Error in requestOTPForPasswordReset:', err.message);
    res.status(400).json({ error: 'Request OTP failed', details: err.message });
  }
};

// Reset Password with OTP
const resetPasswordWithOTP = async (req, res) => {
  const { email, otp, new_password } = req.body;

  try {
    if (!email || !otp || !new_password) {
      return res.status(400).json({ error: 'All fields are required!' });
    }

    const sanitizedEmail = email.trim().toLowerCase();
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Retrieve the OTP record
    const { data: otpRecord, error: otpError } = await supabase
      .from('otps')
      .select('*')
      .eq('email', sanitizedEmail)
      .eq('otp', otp)
      .eq('purpose', 'password_reset')
      .single();

    if (otpError || !otpRecord || new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    console.log('Valid OTP Record:', otpRecord);

    // Update the user's password
    const { error: updateError } = await supabase
      .from('users')
      .update({ password: hashedPassword })
      .eq('email', sanitizedEmail);

    if (updateError) {
      console.log('Update Error:', updateError);
      throw new Error('Password update failed');
    }

    console.log('Password updated successfully for:', sanitizedEmail);

    res.status(200).json({ message: 'Password reset successful!' });
  } catch (err) {
    console.error('Error in resetPasswordWithOTP:', err.message);
    res.status(500).json({ error: 'Reset password failed', details: err.message });
  }
};

// resend otp
const otpRequests = {}; // Temporary store for tracking OTP requests by email or IP

const resendOTP = async (req, res) => {
    const { email, purpose } = req.body;

    try {
        // Input validation
        if (!email || !purpose) {
            return res.status(400).json({ error: 'Email and purpose are required.' });
        }

        // Normalize email for case-insensitivity
        const sanitizedEmail = email.trim().toLowerCase();
        const otp = generateOTP(); // Generate a new OTP
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress; // Track IP address

        // Rate-limiting: Allow max 3 OTP requests per email per hour
        if (!otpRequests[sanitizedEmail]) {
            otpRequests[sanitizedEmail] = { count: 0, lastRequest: Date.now() };
        } else if (
            otpRequests[sanitizedEmail].count >= 3 &&
            Date.now() - otpRequests[sanitizedEmail].lastRequest < 60 * 60 * 1000
        ) {
            return res.status(429).json({ error: 'Too many OTP requests. Please try again later.' });
        }

        // Invalidate existing OTPs for the same purpose
        await supabase.from('otps').delete().match({ email: sanitizedEmail, purpose });

        // Send the new OTP via email
        await sendOTPEmail(sanitizedEmail, otp, purpose);

        // Insert the new OTP into the database
        const { error } = await supabase.from('otps').insert([{ email: sanitizedEmail, otp, purpose, expires_at: expiresAt }]);
        if (error) throw error;

        // Update OTP request tracking for this email
        otpRequests[sanitizedEmail].count++;
        otpRequests[sanitizedEmail].lastRequest = Date.now();

        // Respond with success
        res.status(200).json({ message: `A new OTP has been sent for ${purpose}. Please check your email.` });
    } catch (err) {
        console.error('Resend OTP Error:', err.message);
        res.status(500).json({ error: 'Resend OTP failed. Please try again later.', details: err.message });
    }
};

// Superuser Login Function
const superuserLogin = async (req, res) => {
    const { email, password } = req.body;

    // Validate request input
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        // Normalize the email
        const sanitizedEmail = email.trim().toLowerCase();

        // Fetch superuser from the database
        const { data: superuser, error } = await supabase
            .from('superusers')
            .select('id, email, username, password') // Select only necessary fields
            .eq('email', sanitizedEmail)
            .single();

        if (error || !superuser) {
            console.warn('Superuser not found or query error:', error);
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        console.log('Superuser fetched:', superuser);

        // Compare the plain text password with the hashed password
        const isPasswordValid = await bcrypt.compare(password, superuser.password);
        if (!isPasswordValid) {
            console.warn('Invalid password attempt for email:', sanitizedEmail);
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Generate a JWT token
        const token = jwt.sign(
            {
                id: superuser.id,
                email: superuser.email,
                username: superuser.username,
                is_superuser: true,
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' } // Token expires in 1 hour
        );

        console.log('JWT token generated for superuser:', sanitizedEmail);

        // Set the JWT as an HTTP-only secure cookie
        res.cookie('token', token, {
            httpOnly: true, // Prevent access via JavaScript
            secure: process.env.NODE_ENV === 'production', // Only send cookies over HTTPS in production
            sameSite: 'Strict', // Prevent CSRF attacks
            maxAge: 60 * 60 * 1000, // Expire after 1 hour
        });

        // Respond with success, excluding the token in the JSON response
        res.status(200).json({
            message: 'Superuser login successful.',
            user: {
                id: superuser.id, // UID included in the response
                email: superuser.email,
                username: superuser.username,
                is_superuser: true,
            },
        });
    } catch (err) {
        console.error('Superuser Login Error:', err.message);
        res.status(500).json({ error: 'Internal server error. Please try again later.' });
    }
};

// Export all handlers
module.exports = {
    signup,
    login,
    superuserLogin,
    requestOTPForPasswordReset,
    resetPasswordWithOTP,
    verifyEmailWithOTP,
    resendOTP,
};
