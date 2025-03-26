const express = require('express');
const { supabase } = require('../supabaseClient'); // Import Supabase client
const rateLimit = {}; // Temporary store for rate-limiting (should ideally use a database for scalability)
const router = express.Router();

/// ------------------ Review Endpoints ------------------ ///

// Add a new review
router.post('/add', async (req, res) => {
    const { user_id, name, product_id, rating, feedback } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress; // Track the IP address

    try {
        // Input validation
        if (!user_id || !name || !product_id || !rating || !feedback) {
            return res.status(400).json({ error: 'All fields (user_id, name, product_id, rating, feedback) are required.' });
        }

        if (rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
        }

        if (feedback.length > 500) {
            return res.status(400).json({ error: 'Feedback must not exceed 500 characters.' });
        }

        // Rate-limiting (max 3 reviews per user/IP within 1 hour)
        if (!rateLimit[ip]) {
            rateLimit[ip] = { count: 0, lastAttempt: Date.now() };
        }
        if (
            rateLimit[ip].count >= 3 &&
            Date.now() - rateLimit[ip].lastAttempt < 60 * 60 * 1000
        ) {
            return res.status(429).json({ error: 'Too many review submissions from this IP. Please try again later.' });
        }

        // Insert the review into the database
        const { data: reviewData, error: reviewError } = await supabase
            .from('reviews')
            .insert([
                {
                    user_id,
                    username: name.trim(),
                    product_id,
                    rating: parseFloat(rating),
                    feedback: feedback.trim(),
                },
            ])
            .select();

        if (reviewError) {
            console.error('Error inserting review:', reviewError.message);
            return res.status(400).json({ error: 'Failed to submit review. Please try again later.' });
        }

        // Update rate-limiting for this IP
        rateLimit[ip].count++;
        rateLimit[ip].lastAttempt = Date.now();

        res.status(201).json({
            message: 'Review submitted successfully!',
            review: reviewData[0],
        });
    } catch (err) {
        console.error('Unexpected Review Submission Error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Add a reply to a review
router.post('/reply', async (req, res) => {
    const { review_id, product_id, user_id, name, reply } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress; // Track the IP address

    try {
        // Input validation
        if (!review_id || !product_id || !user_id || !name || !reply) {
            return res.status(400).json({ error: 'All fields (review_id, product_id, user_id, name, reply) are required.' });
        }

        if (reply.length > 300) {
            return res.status(400).json({ error: 'Reply must not exceed 300 characters.' });
        }

        // Rate-limiting (max 5 replies per user/IP within 1 hour)
        if (!rateLimit[ip]) {
            rateLimit[ip] = { count: 0, lastAttempt: Date.now() };
        }
        if (
            rateLimit[ip].count >= 5 &&
            Date.now() - rateLimit[ip].lastAttempt < 60 * 60 * 1000
        ) {
            return res.status(429).json({ error: 'Too many replies submitted from this IP. Please try again later.' });
        }

        // Insert the reply into the database
        const { data: replyData, error: replyError } = await supabase
            .from('replies')
            .insert([
                {
                    review_id,
                    product_id,
                    user_id,
                    username: name.trim(),
                    reply: reply.trim(),
                },
            ])
            .select();

        if (replyError) {
            console.error('Error inserting reply:', replyError.message);
            return res.status(400).json({ error: 'Failed to submit reply. Please try again later.' });
        }

        // Update rate-limiting for this IP
        rateLimit[ip].count++;
        rateLimit[ip].lastAttempt = Date.now();

        res.status(201).json({
            message: 'Reply submitted successfully!',
            reply: replyData[0],
        });
    } catch (err) {
        console.error('Unexpected Reply Submission Error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch all reviews with replies
router.get('/reviews', async (req, res) => {
    const { product_id } = req.query;

    try {
        // Input validation
        if (!product_id) {
            return res.status(400).json({ error: 'Product ID is required to fetch reviews.' });
        }

        // Fetch all reviews with associated replies for the specified product
        const { data, error } = await supabase
            .from('reviews')
            .select(`
                id,
                user_id,
                product_id,
                username,
                rating,
                feedback,
                created_at,
                replies (
                    id,
                    review_id,
                    product_id,
                    user_id,
                    username,
                    reply,
                    created_at
                )
            `)
            .eq('product_id', product_id)
            .order('created_at', { ascending: false }); // Sort by newest reviews first

        if (error) {
            console.error('Error fetching reviews:', error.message);
            return res.status(400).json({ error: 'Failed to fetch reviews.' });
        }

        res.status(200).json({
            message: 'Reviews fetched successfully!',
            reviews: data,
        });
    } catch (err) {
        console.error('Unexpected Reviews Fetch Error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
