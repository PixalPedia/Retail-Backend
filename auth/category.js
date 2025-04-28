const express = require('express');
const { supabase } = require('../supabaseClient');
const router = express.Router();

// Helper Function: Check Superuser
const isSuperUser = async (user_id) => {
    try {
        const { data: superuser, error } = await supabase
            .from('superusers')
            .select('*')
            .eq('id', user_id)
            .single();

        if (error) {
            console.error('Superuser Check Error:', error.message);
            return false;
        }

        return superuser !== null;
    } catch (err) {
        console.error('Unexpected Error in Superuser Check:', err.message);
        return false;
    }
};

// Add Category
router.post('/add', async (req, res) => {
    const { name, user_id } = req.body;

    try {
        if (!user_id) {
            return res.status(400).json({ error: 'User ID is required.' });
        }

        const isSuper = await isSuperUser(user_id);
        if (!isSuper) {
            return res.status(403).json({ error: 'Only superusers can add categories.' });
        }

        const trimmedName = name?.trim();
        if (!trimmedName) {
            return res.status(400).json({ error: 'Category name is required.' });
        }

        const { data, error } = await supabase
            .from('categories')
            .insert([{ name: trimmedName }])
            .select();

        if (error) {
            console.error('Insert Error:', error.message);
            return res.status(500).json({ error: `Failed to add category. Supabase error: ${error.message}` });
        }

        res.status(201).json({
            message: 'Category added successfully!',
            category: data[0],
        });
    } catch (err) {
        console.error('Unexpected Error in Add Category:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Edit Category
router.put('/edit', async (req, res) => {
    const { id, name, user_id } = req.body;
  
    try {
      // Validate Input
      if (!user_id) {
        return res.status(400).json({ error: 'User ID is required.' });
      }
      if (!id) {
        return res.status(400).json({ error: 'Category ID is required.' });
      }
      const trimmedName = name?.trim();
      if (!trimmedName) {
        return res.status(400).json({ error: 'Category name is required.' });
      }
  
      // Check if the user is a superuser
      const isSuper = await isSuperUser(user_id);
      if (!isSuper) {
        return res.status(403).json({ error: 'Only superusers can edit categories.' });
      }
  
      // Check if the category exists
      const { data: existingCategory, error: fetchError } = await supabase
        .from('categories')
        .select('*')
        .eq('id', id)
        .single();
  
      if (fetchError || !existingCategory) {
        return res.status(404).json({ error: 'Category not found.' });
      }
  
      // Update the category name
      const { data, error: updateError } = await supabase
        .from('categories')
        .update({ name: trimmedName })
        .eq('id', id)
        .select();
  
      if (updateError) {
        console.error('Category Update Error:', updateError.message);
        return res.status(500).json({ error: `Failed to update category. Supabase error: ${updateError.message}` });
      }
  
      res.status(200).json({
        message: `Category with ID ${id} successfully updated to "${trimmedName}".`,
        category: data[0],
      });
    } catch (err) {
      console.error('Error in Edit Category:', err.message);
      res.status(500).json({ error: 'Internal server error.' });
    }
});
  
// Fetch All Categories
router.get('/list', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('categories')
            .select('*')
            .order('name', { ascending: true });

        if (error) {
            console.error('Error Fetching Categories:', error.message);
            return res.status(500).json({ error: 'Failed to fetch categories.' });
        }

        res.status(200).json(data);
    } catch (err) {
        console.error('Error in Fetch Categories:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch Products by Category
router.post('/products', async (req, res) => {
    const { category_id } = req.body;

    try {
        // Validate Input
        if (!category_id) {
            return res.status(400).json({ error: 'Category ID is required.' });
        }

        // Fetch products linked to the given category ID through the bridge table
        const { data, error } = await supabase
            .from('product_categories')
            .select(`
                product_id,
                products (
                    id,
                    title,
                    description,
                    price,
                    is_discounted,
                    discount_amount,
                    images,
                    stock_quantity,
                    created_at
                )
            `)
            .eq('category_id', category_id);

        if (error) {
            console.error('Error fetching products by category ID:', error.message);
            return res.status(500).json({ error: 'Failed to fetch products for the given category.' });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ message: 'No products found for the given category.' });
        }

        // Extract products
        const products = data.map(entry => entry.products);

        res.status(200).json({
            message: `Products fetched successfully for category ID: ${category_id}`,
            products,
        });
    } catch (err) {
        console.error('Unexpected Error in Fetch Products by Category ID:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Delete Category
router.delete('/delete', async (req, res) => {
    const { id, user_id } = req.body;

    try {
        if (!user_id) {
            return res.status(400).json({ error: 'User ID is required.' });
        }

        if (!id) {
            return res.status(400).json({ error: 'Category ID is required.' });
        }

        const isSuper = await isSuperUser(user_id);
        if (!isSuper) {
            return res.status(403).json({ error: 'Only superusers can delete categories.' });
        }

        const { data: category, error: fetchError } = await supabase
            .from('categories')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !category) {
            return res.status(404).json({ error: 'Category not found.' });
        }

        const { data, error: deleteError } = await supabase
            .from('categories')
            .delete()
            .eq('id', id);

        if (deleteError) {
            console.error('Category Deletion Error:', deleteError.message);
            return res.status(500).json({ error: `Failed to delete category. Supabase error: ${deleteError.message}` });
        }

        res.status(200).json({ message: `Category with ID ${id} successfully deleted.` });
    } catch (err) {
        console.error('Error in Delete Category:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
