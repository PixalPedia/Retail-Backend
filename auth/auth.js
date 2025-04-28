const nodemailer = require('nodemailer');
const { supabase, supabaseAdmin } = require('../supabaseClient'); // Import Supabase clients
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Buffer } = require('buffer');

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
    <h1 style="font-size: 24px; margin-bottom: 20px;">Welcome to <strong>Your Company Name</strong>!</h1>
    
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
        <p style="margin: 0;">[Your Company Name] | Contact: info@yourcompany.com</p>
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

// Function to check email verification status
const isEmailVerified = async (email) => {
    try {
        // Normalize the email
        const sanitizedEmail = email.trim().toLowerCase();

        // Fetch the user's verification status from the database
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('is_email_verified') // Correct field based on your table schema
            .eq('email', sanitizedEmail)
            .single();

        if (userError || !user) {
            console.error('User not found or error fetching user:', userError?.message);
            return { verified: false, error: 'User not found or an error occurred.' };
        }

        // Return the verification status
        return { verified: user.is_email_verified, error: null };
    } catch (err) {
        console.error('Verification Check Error:', err.message);
        return { verified: false, error: 'An unexpected error occurred during verification.' };
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

        // Normalize email and username
        const sanitizedEmail = email.trim().toLowerCase();
        const sanitizedUsername = username.trim();

        // Step 1: Check if email already exists
        const { data: existingUser, error: existingUserError } = await supabase
            .from('users')
            .select('id')
            .eq('email', sanitizedEmail)
            .single();

        if (existingUserError && existingUserError.code !== 'PGRST116') throw existingUserError;

        if (existingUser) {
            return res.status(409).json({ error: 'Email already exists. Please use a different email address.' });
        }

        // Step 2: Rate-limiting
        const { data: signupData, error: signupError } = await supabase
            .from('signup_limits')
            .select('*')
            .eq('ip_address', ip)
            .eq('email', sanitizedEmail)
            .single();

        if (signupError && signupError.code !== 'PGRST116') throw signupError;

        if (signupData) {
            const attemptsExceeded =
                signupData.attempts >= 5 &&
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
                    last_attempt: new Date(),
                })
                .eq('id', signupData.id);
        } else {
            // Insert a new record for signup attempts
            await supabase
                .from('signup_limits')
                .insert([
                    {
                        ip_address: ip,
                        email: sanitizedEmail,
                        attempts: 1,
                        last_attempt: new Date(),
                    },
                ]);
        }

        // Step 3: Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Step 4: Insert the user into the database
        const { data: userData, error: userError } = await supabase
            .from('users')
            .insert([{ email: sanitizedEmail, password: hashedPassword, username: sanitizedUsername }])
            .select();

        if (userError) throw userError;

        // Step 5: Delete any existing OTPs for email verification
        const { error: deleteOtpError } = await supabase
            .from('otps')
            .delete()
            .eq('email', sanitizedEmail)
            .eq('purpose', 'email_verification');

        if (deleteOtpError) throw deleteOtpError;

        // Step 6: Generate OTP for email verification
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes
        console.log('Generated OTP and expiration time:', { otp, expiresAt });

        // Insert the new OTP
        const { error: insertOtpError } = await supabase
            .from('otps')
            .insert([
                {
                    email: sanitizedEmail,
                    otp,
                    purpose: 'email_verification',
                    expires_at: expiresAt,
                },
            ]);

        if (insertOtpError) throw insertOtpError;

        // Send OTP email
        await sendOTPEmail(sanitizedEmail, otp, 'email verification');

        // Step 7: Respond with success
        res.status(201).json({
            message: 'Signup successful! Please verify your email using the OTP sent to your email.',
            user: {
                id: userData[0].id,
                email: sanitizedEmail,
                username: sanitizedUsername,
            },
        });
    } catch (err) {
        console.error('Signup Error:', err.message);
        res.status(500).json({ error: 'Signup failed.', details: err.message });
    }
};

// Login function
const login = async (req, res) => {
  const { email, password } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  try {
    // Validate inputs
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // Normalize the email
    const sanitizedEmail = email.trim().toLowerCase();

    // Check if the user exists
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, username, email, password, is_email_verified')
      .eq('email', sanitizedEmail)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User does not exist. Please register first.' });
    }

    // Check if the email is verified
    if (!user.is_email_verified) {
      return res.status(403).json({ error: 'Email not verified. Please verify your email to log in.' });
    }

    // Fetch failed login attempts from the database
    const { data: attemptRecord, error: attemptError } = await supabase
      .from('failed_login_attempts')
      .select('*')
      .eq('email', sanitizedEmail)
      .eq('ip_address', ip)
      .single();

    if (attemptError && attemptError.code !== 'PGRST116') {
      throw new Error('Failed to fetch login attempts.');
    }

    // Check if the account is temporarily locked
    if (
      attemptRecord &&
      attemptRecord.failed_attempts >= 5 &&
      new Date() < new Date(attemptRecord.locked_until)
    ) {
      const lockRemaining = calculateLockRemaining(attemptRecord.locked_until);
      return res.status(403).json({
        error: `Too many failed attempts. Account is locked. Try again after ${lockRemaining} minutes.`,
      });
    }

    // Compare the provided password with the hashed password from the database
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      await handleFailedLogin(sanitizedEmail, ip, attemptRecord);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Reset failed attempts on successful login
    await supabase
      .from('failed_login_attempts')
      .delete()
      .match({ email: sanitizedEmail, ip_address: ip });

    // Generate JWT token for authentication
    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Set the JWT as an HTTP-only cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 60 * 60 * 1000,
    });

    // Public Authentication Token Generation:
    // This function will merge the user id with the secret.
    // It reads the secret from process.env.USER_TOKEN_SECRET, splits it into two halves,
    // then creates a merged string: <secretFirst> + userId + <secretSecond>.
    // The merged string is Base64-encoded and further wrapped with a random prefix and suffix.
    // Prefix: 20 hex characters; Suffix: 16 hex characters.
    const generatePublicAuthToken = (userId) => {
      const secret = process.env.USER_TOKEN_SECRET;
      if (!secret) {
        throw new Error('USER_TOKEN_SECRET is not set in environment variables');
      }
      // Split the secret into two halves
      const splitIndex = Math.floor(secret.length / 2);
      const secretFirst = secret.slice(0, splitIndex);
      const secretSecond = secret.slice(splitIndex);
      
      // Merge secret halves with the user ID: <secretFirst> + userId + <secretSecond>
      const merged = secretFirst + userId + secretSecond;
      
      // Base64-encode the merged string
      const encodedMerged = Buffer.from(merged).toString('base64');
      
      // Generate random prefix (20 hex characters) and suffix (16 hex characters)
      const prefix = crypto.randomBytes(10).toString('hex'); // 10 bytes = 20 hex characters
      const suffix = crypto.randomBytes(8).toString('hex');    // 8 bytes = 16 hex characters
      
      // Return: prefix + encodedMerged + suffix
      return prefix + encodedMerged + suffix;
    };

    // Generate the public authentication token using the user's id.
    const publicAuthToken = generatePublicAuthToken(user.id);

    // Send success response along with the publicAuthToken.
    res.status(200).json({
      message: 'Login successful.',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
      publicAuthToken, // This token will be used in subsequent requests.
    });
  } catch (err) {
    console.error('Login Error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.', details: err.message });
  }
};

// Helper function: Calculate lock remaining time
const calculateLockRemaining = (lockedUntil) => {
    return Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60000); // Remaining minutes
};

// Helper function: Handle failed login attempt
const handleFailedLogin = async (email, ip, attemptRecord) => {
    const newFailedAttempts = attemptRecord ? attemptRecord.failed_attempts + 1 : 1;
    const lockUntil = newFailedAttempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null; // Lock for 30 minutes after 5 failed attempts

    if (attemptRecord) {
        // Update failed login attempts in the database
        await supabase
            .from('failed_login_attempts')
            .update({
                failed_attempts: newFailedAttempts,
                locked_until: lockUntil,
            })
            .eq('email', email)
            .eq('ip_address', ip);
    } else {
        // Insert new failed login attempt record
        await supabase
            .from('failed_login_attempts')
            .insert([
                {
                    email,
                    ip_address: ip,
                    failed_attempts: 1,
                    locked_until: null,
                },
            ]);
    }
};

// VerifyEmailwithotp fucntion
const verifyEmailWithOTP = async (req, res) => {
    const { email, otp } = req.body;

    try {
        // Input validation
        if (!email || !otp) {
            return res.status(400).json({ error: 'Email and OTP are required.' });
        }

        // Normalize email for case-insensitivity
        const sanitizedEmail = email.trim().toLowerCase();
        console.log('Sanitized Email:', sanitizedEmail);
        console.log('Provided OTP:', otp);

        // Fetch the OTP record
        const { data: otpRecord, error: otpError } = await supabase
            .from('otps')
            .select('*')
            .eq('email', sanitizedEmail)
            .eq('otp', otp)
            .eq('purpose', 'email_verification')
            .single();

        console.log('OTP Record:', otpRecord);
        console.log('OTP Query Error:', otpError);

        // Validate OTP record
        if (otpError || !otpRecord) {
            return res.status(400).json({ error: 'Invalid or expired OTP.' });
        }

        // Check if the OTP has expired
        if (new Date(otpRecord.expires_at) < new Date()) {
            console.error('Expired OTP:', otpRecord);
            return res.status(400).json({ error: 'Invalid or expired OTP.' });
        }

        console.log('Valid OTP Record:', otpRecord);

        // Mark the user as email verified
        const { error: updateError } = await supabase
            .from('users')
            .update({ is_email_verified: true })
            .eq('email', sanitizedEmail);

        if (updateError) {
            console.error('Email Verification Update Error:', updateError.message);
            throw new Error('Failed to update email verification.');
        }

        console.log('Email verified successfully for:', sanitizedEmail);

        res.status(200).json({ message: 'Email verified successfully!' });
    } catch (err) {
        console.error('Verification Error:', err.message);
        res.status(500).json({ error: 'Verification failed.', details: err.message });
    }
};


// Request OTP for password reset
const requestOTPForPasswordReset = async (req, res) => {
    const { email } = req.body;
  
    try {
        if (!email) {
            return res.status(400).json({ error: 'Email is required.' });
        }

        // Normalize the email to lowercase for consistency
        const sanitizedEmail = email.trim().toLowerCase();

        // Step 1: Check if email exists in the users table
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id') // Select only the 'id' field for verification
            .eq('email', sanitizedEmail)
            .single(); // Expect only one user

        if (userError && userError.code !== 'PGRST116') {
            console.error('Error checking user existence:', userError.message);
            throw new Error('Error checking user existence.');
        }

        if (!user) {
            // If user with the provided email does not exist
            return res.status(404).json({ error: 'No account found with this email address.' });
        }

        // Step 2: Generate a new OTP
        const otp = generateOTP(); // Generate a new OTP
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes
        console.log('Generated OTP and expiration time:', { otp, expiresAt });

        // Step 3: Delete existing OTPs for the same email and purpose
        const { error: deleteError } = await supabase
            .from('otps')
            .delete()
            .match({ email: sanitizedEmail, purpose: 'password_reset' });

        if (deleteError) {
            console.error('Error deleting existing OTPs:', deleteError.message);
            throw new Error('Failed to delete previous OTPs.');
        }
        console.log('Old OTPs deleted successfully for:', sanitizedEmail);

        // Step 4: Insert the new OTP into the database
        const { error: insertError } = await supabase
            .from('otps')
            .insert([
                {
                    email: sanitizedEmail,
                    otp,
                    purpose: 'password_reset',
                    expires_at: expiresAt,
                },
            ]);

        if (insertError) {
            console.error('Error inserting new OTP:', insertError.message);
            throw new Error('Failed to insert new OTP.');
        }
        console.log('New OTP inserted successfully for:', sanitizedEmail);

        // Step 5: Send the OTP email
        await sendOTPEmail(sanitizedEmail, otp, 'password reset');
        console.log('OTP email sent successfully to:', sanitizedEmail);

        // Step 6: Respond with success
        res.status(200).json({ message: 'OTP sent for password reset. Please check your email.' });
    } catch (err) {
        console.error('Error in requestOTPForPasswordReset:', err.message);
        res.status(400).json({ error: 'Request OTP failed.', details: err.message });
    }
};

// Reset Password with OTP
const resetPasswordWithOTP = async (req, res) => {
    const { email, otp, new_password } = req.body;
  
    try {
      // Validate input
      if (!email || !otp || !new_password) {
        return res.status(400).json({ error: 'All fields are required!' });
      }
  
      // Normalize email to ensure case-insensitivity
      const sanitizedEmail = email.trim().toLowerCase();
      console.log('Sanitized Email:', sanitizedEmail);
      console.log('Provided OTP:', otp);
  
      // Hash the new password
      const hashedPassword = await bcrypt.hash(new_password, 10);
  
      // Fetch the OTP record with email, otp, and purpose validation
      const { data: otpRecord, error: otpError } = await supabase
        .from('otps')
        .select('*')
        .eq('email', sanitizedEmail) // Always use sanitized email
        .eq('otp', otp)
        .eq('purpose', 'password_reset')
        .single();
  
      console.log('OTP Record:', otpRecord);
      console.log('OTP Query Error:', otpError);
  
      // Validate OTP record and check for errors
      if (otpError || !otpRecord) {
        return res.status(400).json({ error: 'Invalid OTP' });
      }
  
      // Check OTP expiration
      if (new Date(otpRecord.expires_at) < new Date()) {
        console.error('Expired OTP:', otpRecord);
        return res.status(400).json({ error: 'Expired OTP' });
      }
  
      console.log('Valid OTP Record:', otpRecord);
  
      // Update the user's password in the database
      const { error: updateError } = await supabase
        .from('users')
        .update({ password: hashedPassword })
        .eq('email', sanitizedEmail); // Use sanitized email for the update
  
      if (updateError) {
        console.error('Password Update Error:', updateError.message);
        throw new Error('Password update failed');
      }
  
      console.log('Password updated successfully for:', sanitizedEmail);
  
      // Invalidate the OTP after password reset
      const { error: invalidateError } = await supabase
        .from('otps')
        .delete()
        .match({ id: otpRecord.id });
  
      if (invalidateError) {
        console.error('Error invalidating OTP:', invalidateError.message);
        throw new Error('Failed to invalidate OTP');
      }
  
      console.log('OTP invalidated successfully for:', sanitizedEmail);
  
      res.status(200).json({ message: 'Password reset successful!' });
    } catch (err) {
      console.error('Error in resetPasswordWithOTP:', err.message);
      res.status(500).json({ error: 'Reset password failed', details: err.message });
    }
  };  

  // Resend OTP Function
  const otpRequests = {}; // Temporary store for tracking OTP requests by email or IP

  const resendOTP = async (req, res) => {
      const { email, purpose } = req.body;
  
      try {
          // Input validation
          if (!email || !purpose) {
              return res.status(400).json({ error: 'Email and purpose are required.' });
          }
  
          // Validate purpose
          const allowedPurposes = ['password_reset', 'email_verification'];
          if (!allowedPurposes.includes(purpose)) {
              return res.status(400).json({ error: 'Invalid purpose specified.' });
          }
  
          // Normalize email for case-insensitivity
          const sanitizedEmail = email.trim().toLowerCase();
  
          // For purpose "email_verification", check if email is already verified
          if (purpose === 'email_verification') {
              const verificationStatus = await isEmailVerified(sanitizedEmail); // Check email verification status
              if (verificationStatus.verified) {
                  return res.status(400).json({ error: 'This email is already verified.' });
              }
              if (verificationStatus.error) {
                  return res.status(500).json({ error: verificationStatus.error });
              }
          }
  
          const otp = generateOTP(); // Generate a new OTP
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes
          const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress; // Track IP address
  
          console.log('Generated OTP:', otp);
          console.log('Sanitized Email:', sanitizedEmail);
          console.log('Request Purpose:', purpose);
  
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
  
          console.log('Inserted new OTP into the database for:', sanitizedEmail);
  
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

    console.log('Password validated for superuser:', sanitizedEmail);

    // Generate JWT token for authentication
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

    // Generate a public authentication token that hides the superuser's ID.
    // This function uses the secret from process.env.USER_TOKEN_SECRET.
    // It splits the secret into two halves and merges them around the user ID.
    // The merged string is Base64-encoded and wrapped with a random prefix (20 hex characters)
    // and a random suffix (16 hex characters).
    const generatePublicAuthToken = (userId) => {
      const secret = process.env.USER_TOKEN_SECRET;
      if (!secret) {
        throw new Error('USER_TOKEN_SECRET is not set in environment variables');
      }
      // Split the secret into two halves.
      const splitIndex = Math.floor(secret.length / 2);
      const secretFirst = secret.slice(0, splitIndex);
      const secretSecond = secret.slice(splitIndex);

      // Merge the secret halves with the user ID.
      const merged = secretFirst + userId + secretSecond;

      // Base64-encode the merged string.
      const encodedMerged = Buffer.from(merged).toString('base64');

      // Generate a random prefix (20 hex characters) and a random suffix (16 hex characters).
      const prefix = crypto.randomBytes(10).toString('hex'); // 10 bytes = 20 hex characters
      const suffix = crypto.randomBytes(8).toString('hex');    // 8 bytes = 16 hex characters

      // Return the final token.
      return prefix + encodedMerged + suffix;
    };

    // Generate the token using the superuser's id.
    const publicAuthToken = generatePublicAuthToken(superuser.id);

    // Respond with success, including the publicAuthToken.
    res.status(200).json({
      message: 'Superuser login successful.',
      user: {
        id: superuser.id,
        email: superuser.email,
        username: superuser.username,
        is_superuser: true,
      },
      publicAuthToken, // Use this token in subsequent requests from the frontend.
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
