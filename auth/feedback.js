const express = require('express');
const { supabase } = require('../supabaseClient'); // Your Supabase client setup
const nodemailer = require('nodemailer');
const router = express.Router();

router.post('/contact', async (req, res) => {
  try {
    // Extract the contact details from the request body
    const { user_id, name, email, message } = req.body;
    if (!user_id || !name || !email || !message) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    // Calculate the timestamp for 12 hours ago
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

    // Check how many feedback entries exist from this user in the last 12 hours
    const { count, error: countError } = await supabase
      .from('contacts')
      .select('id', { count: 'exact' })
      .eq('user_id', user_id)
      .gte('created_at', twelveHoursAgo);

    if (countError) {
      console.error('Error fetching feedback count:', countError);
      return res.status(500).json({ error: 'Error checking feedback limit.' });
    }

    if (count >= 3) {
      return res.status(429).json({
        error: 'Feedback limit reached. You can only submit 3 feedbacks every 12 hours.'
      });
    }

    // Insert the new contact record into the "contacts" table
    const { data: contactData, error: insertError } = await supabase
      .from('contacts')
      .insert([{ user_id, name, email, message }]);
    if (insertError) {
      console.error('Insert error:', insertError);
      return res.status(400).json({ error: insertError.message });
    }

    // Fetch the superuser's email from the "superusers" table
    const { data: superuserData, error: superuserError } = await supabase
      .from('superusers')
      .select('email')
      .limit(1)
      .single();
    if (superuserError || !superuserData) {
      console.error('Superuser fetch error:', superuserError);
      return res.status(404).json({ error: 'Superuser email not found.' });
    }
    const superuserEmail = superuserData.email;

    // Set up nodemailer transporter with your SMTP settings.
    // Here we're using Gmail as an example.
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_ADDRESS, // Your email address from environment variable
        pass: process.env.EMAIL_PASSWORD,  // Your email password from environment variable
      },
    });

    // Create the HTML content for the email
    const mailContent = `
      <h2>New Contact Message Received</h2>
      <p><strong>User ID:</strong> ${user_id}</p>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Message:</strong> ${message}</p>
    `;

    const mailOptions = {
      from: process.env.EMAIL_ADDRESS,
      to: superuserEmail,
      subject: 'New Contact Message Received',
      html: mailContent,
    };

    // Send the email
    await transporter.sendMail(mailOptions);

    return res.status(200).json({ message: 'Contact submitted and email sent successfully.' });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Endpoint to fetch all feedbacks
router.get('/feedbacks', async (req, res) => {
  try {
    // Query all feedback entries from the contacts table.
    // Here we order them by created_at in descending order so that the newest feedbacks come first.
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching feedbacks:', error);
      return res.status(500).json({ error: 'Failed to fetch feedbacks.' });
    }

    return res.status(200).json({ feedbacks: data });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
