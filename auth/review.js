const express = require('express');
const { supabase } = require('../supabaseClient'); // Import Supabase client
const rateLimit = {}; // Temporary store for rate-limiting (should ideally use a database for scalability)
const router = express.Router();

// Helper Function: Check Superuser Permissions
const isSuperUser = async (user_id) => {
    try {
        const { data: superuser, error } = await supabase
            .from('superusers') // Reference the superusers table
            .select('id')
            .eq('id', user_id)
            .single();

        if (error || !superuser) {
            console.error('Superuser Check Failed:', error?.message || 'Superuser not found');
            return false;
        }

        console.log(`Superuser verified: ${user_id}`);
        return true;
    } catch (err) {
        console.error('Unexpected error while checking superuser:', err.message);
        return false;
    }
};

/// ------------------ Review Endpoints ------------------ ///

// Add a new review (users only, no superusers allowed)
router.post('/add', async (req, res) => {
    const { user_id, name, product_id, rating, feedback, is_superuser } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress; // Track the IP address

    try {
        // Superusers are not allowed to add reviews
        if (is_superuser) {
            return res.status(403).json({ error: 'Superusers are not allowed to post reviews.' });
        }

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

        // Check if a review for this product by the same user already exists
        const { data: existingReview, error: existingReviewError } = await supabase
            .from('reviews')
            .select('*')
            .eq('product_id', product_id)
            .eq('user_id', user_id);

        if (existingReviewError) {
            console.error('Error checking existing review:', existingReviewError.message);
            return res.status(400).json({ error: 'Failed to check existing reviews.' });
        }

        if (existingReview.length > 0) {
            return res.status(400).json({ error: 'You have already reviewed this product.' });
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

        res.status(201).json({
            message: 'Review submitted successfully!',
            review: reviewData[0],
        });
    } catch (err) {
        console.error('Unexpected Review Submission Error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Edit a review (users can edit their own review)
router.put('/edit', async (req, res) => {
    const { review_id, user_id, rating, feedback } = req.body;

    try {
        // Input validation
        if (!review_id || !user_id || !rating || !feedback) {
            return res.status(400).json({ error: 'All fields (review_id, user_id, rating, feedback) are required.' });
        }

        if (rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
        }

        if (feedback.length > 500) {
            return res.status(400).json({ error: 'Feedback must not exceed 500 characters.' });
        }

        // Update the review
        const { data, error } = await supabase
            .from('reviews')
            .update({ rating: parseFloat(rating), feedback: feedback.trim() })
            .eq('id', review_id)
            .eq('user_id', user_id);

        if (error) {
            console.error('Error editing review:', error.message);
            return res.status(400).json({ error: 'Failed to edit review.' });
        }

        res.status(200).json({ message: 'Review edited successfully!', review: data });
    } catch (err) {
        console.error('Unexpected Review Edit Error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Delete a review (users can delete their own review)
router.delete('/delete', async (req, res) => {
    const { review_id, user_id } = req.body;

    try {
        // Input validation
        if (!review_id || !user_id) {
            return res.status(400).json({ error: 'Both review_id and user_id are required.' });
        }

        // Delete the review
        const { data, error } = await supabase
            .from('reviews')
            .delete()
            .eq('id', review_id)
            .eq('user_id', user_id);

        if (error) {
            console.error('Error deleting review:', error.message);
            return res.status(400).json({ error: 'Failed to delete review.' });
        }

        res.status(200).json({ message: 'Review deleted successfully!', review: data });
    } catch (err) {
        console.error('Unexpected Review Delete Error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Add a reply (users and superusers can reply)
router.post('/reply/add', async (req, res) => {
    // Destructure the request body.
    // Note: For superusers, is_superuser should be true and the "name" is ignored.
    const { review_id, product_id, user_id, name, reply, is_superuser } = req.body;
  
    try {
      // Input validation:
      if (!review_id || !product_id || !user_id || !reply) {
        return res.status(400).json({ error: 'All fields (review_id, product_id, user_id, reply) are required.' });
      }
  
      // For regular users, "name" must be provided.
      if (!is_superuser && (!name || name.trim() === '')) {
        return res.status(400).json({ error: 'Name is required for regular users.' });
      }
  
      if (reply.trim().length > 300) {
        return res.status(400).json({ error: 'Reply must not exceed 300 characters.' });
      }
  
      let finalUsername = '';
  
      // If is_superuser is true, fetch the username from the superusers table.
      if (is_superuser === true) {
        const { data: superUserData, error: superUserError } = await supabase
          .from('superusers')
          .select('username')
          .eq('id', user_id)
          .single();
  
        if (superUserError) {
          console.error('Error checking superuser:', superUserError.message);
          return res.status(500).json({ error: 'Failed to verify superuser.' });
        }
        if (!superUserData) {
          return res.status(400).json({ error: 'Invalid user_id: Superuser does not exist.' });
        }
        finalUsername = superUserData.username;
      } else {
        // For a regular user, verify the user exists in the "users" table.
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('username')
          .eq('id', user_id)
          .single();
  
        if (userError) {
          console.error('Error checking user:', userError.message);
          return res.status(500).json({ error: 'Failed to verify user.' });
        }
        if (!userData) {
          return res.status(400).json({ error: 'Invalid user_id: User does not exist in users or superusers table.' });
        }
        // For regular users, use the provided name (trimmed).
        finalUsername = name.trim();
      }
  
      // Insert the reply into the "replies" table using the determined username.
      const { data, error } = await supabase
        .from('replies')
        .insert([
          {
            review_id,
            product_id,
            user_id,
            username: finalUsername,
            reply: reply.trim(),
          },
        ])
        .select();
  
      if (error) {
        console.error('Error adding reply:', error.message);
        return res.status(400).json({ error: 'Failed to add reply.' });
      }
  
      res.status(201).json({ message: 'Reply added successfully!', reply: data[0] });
    } catch (err) {
      console.error('Unexpected Reply Add Error:', err.message);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });  

// Edit a reply (users edit their own replies, superusers can edit any reply)
router.put('/reply/edit', async (req, res) => {
    const { reply_id, user_id, reply } = req.body;

    try {
        // Input validation
        if (!reply_id || !user_id || !reply) {
            return res.status(400).json({ error: 'All fields (reply_id, user_id, reply) are required.' });
        }

        if (reply.length > 300) {
            return res.status(400).json({ error: 'Reply must not exceed 300 characters.' });
        }

        // Check if the user is a superuser
        const isSuperuser = await isSuperUser(user_id);

        // Superusers can edit any reply; regular users can edit only their own replies
        const query = isSuperuser
            ? { id: reply_id } // Superusers don't need to match user_id
            : { id: reply_id, user_id }; // Regular users must match their own user_id

        const { data, error } = await supabase
            .from('replies')
            .update({ reply: reply.trim() }) // Update the reply text
            .match(query);

        if (error) {
            console.error('Error editing reply:', error.message);
            return res.status(400).json({ error: 'Failed to edit reply. Ensure the reply exists.' });
        }

        res.status(200).json({ message: 'Reply edited successfully!', reply: data });
    } catch (err) {
        console.error('Unexpected Reply Edit Error:', err.message);
        res.status(500).json({ error: 'Internal server error while editing the reply.' });
    }
});

// Delete a reply (users delete their own replies, superusers can delete any reply)
router.delete('/reply/delete', async (req, res) => {
    const { reply_id, user_id } = req.body;

    try {
        // Input validation
        if (!reply_id) {
            return res.status(400).json({ error: 'Reply ID is required.' });
        }

        // Check if the user is a superuser
        const isSuperuser = await isSuperUser(user_id);

        // Superusers can delete any reply; regular users can delete only their own replies
        const query = isSuperuser
            ? { id: reply_id } // Superusers don't need to match user_id
            : { id: reply_id, user_id }; // Regular users must match their own user_id

        const { data, error } = await supabase
            .from('replies')
            .delete()
            .match(query);

        if (error) {
            console.error('Error deleting reply:', error.message);
            return res.status(400).json({ error: 'Failed to delete reply. Ensure the reply exists.' });
        }

        res.status(200).json({ message: 'Reply deleted successfully!', reply: data });
    } catch (err) {
        console.error('Unexpected Reply Delete Error:', err.message);
        res.status(500).json({ error: 'Internal server error while deleting the reply.' });
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

        // Check for errors in the query
        if (error) {
            console.error('Error fetching reviews:', error.message);
            return res.status(400).json({ error: 'Failed to fetch reviews.' });
        }

        // Handle empty reviews scenario
        if (!data || data.length === 0) {
            return res.status(404).json({ message: 'No reviews found for this product.' });
        }

        // Respond with the fetched reviews
        res.status(200).json({
            message: 'Reviews fetched successfully!',
            reviews: data,
        });
    } catch (err) {
        console.error('Unexpected Reviews Fetch Error:', err.message);
        res.status(500).json({ error: 'Internal server error occurred while fetching reviews.' });
    }
});

module.exports = router;