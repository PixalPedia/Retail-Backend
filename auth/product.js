const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { supabase } = require('../supabaseClient'); // Import Supabase
const router = express.Router();

// Multer Setup for File Uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 4 * 1024 * 1024 }, // Max 4 MB per file
});

// Helper Function: Compress and Upload Images
const uploadImageToSupabase = async (buffer, fileName) => {
    try {
        console.log('Compressing image...');
        const compressedImage = await sharp(buffer)
            .resize(1024, 1024, { fit: 'inside' })
            .jpeg({ quality: 80 })
            .toBuffer();

        console.log('Uploading image to Supabase...');
        const timestamp = Date.now();
        const filePath = `products/${timestamp}-${fileName}`;
        const { data, error } = await supabase.storage
            .from('images') // Ensure the bucket name is 'images'
            .upload(filePath, compressedImage, {
                cacheControl: '3600',
                upsert: false,
                contentType: 'image/jpeg',
            });

        if (error) {
            console.error('Supabase Upload Error:', error.message);
            throw new Error('Image upload failed.');
        }

        console.log('Constructing public URL...');
        // Dynamically construct the URL based on SUPABASE_URL
        const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/images/${filePath}`;

        console.log(`Image successfully uploaded: ${publicUrl}`);
        return publicUrl;
    } catch (err) {
        console.error('Error during image upload:', err.message);
        throw err;
    }
};

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

// Add Product
router.post('/add', upload.array('images', 5), async (req, res) => {
    const {
        title,
        description,
        category_ids, // Array of category IDs
        type_ids, // Array of type IDs
        option_ids, // Array of option IDs
        initial_price, // Original price before discount
        price, // Final price after applying discount
        is_discounted,
        discount_amount, // Actual discount amount (not percentage)
        stock_quantity,
        user_id
    } = req.body;
    const files = req.files;

    try {
        // Check Superuser Permissions
        const isSuper = await isSuperUser(user_id);
        if (!isSuper) {
            return res.status(403).json({ error: 'Only superusers are allowed to add products.' });
        }

        // Validate and Parse Inputs
        const parsedCategoryIds = Array.isArray(category_ids) ? category_ids : JSON.parse(category_ids || "[]");
        const parsedTypeIds = Array.isArray(type_ids) ? type_ids : JSON.parse(type_ids || "[]");
        const parsedOptionIds = Array.isArray(option_ids) ? option_ids : JSON.parse(option_ids || "[]");

        if (!title || !initial_price || isNaN(initial_price)) {
            return res.status(400).json({ error: 'Title and initial price are required.' });
        }
        if (parsedCategoryIds.length === 0) {
            return res.status(400).json({ error: 'At least one category ID is required.' });
        }

        // Handle Discount Logic
        const finalPrice = is_discounted === 'true'
            ? parseFloat(initial_price) - parseFloat(discount_amount)
            : parseFloat(initial_price);

        if (finalPrice < 0) {
            return res.status(400).json({ error: 'Discount amount cannot exceed the initial price.' });
        }

        // Validate and Upload Images
        if (files.length > 5) {
            return res.status(400).json({ error: 'You can upload a maximum of 5 images.' });
        }

        const imageUrls = [];
        for (const file of files) {
            try {
                const imageUrl = await uploadImageToSupabase(file.buffer, file.originalname);
                imageUrls.push(imageUrl);
            } catch (err) {
                console.error(`Error uploading image ${file.originalname}:`, err.message);
            }
        }

        if (imageUrls.length === 0) {
            return res.status(400).json({ error: 'No images were successfully uploaded.' });
        }

        // Insert Product into `products` Table
        const { data: productData, error: productError } = await supabase
            .from('products')
            .insert([{
                title,
                description,
                initial_price: parseFloat(initial_price),
                price: finalPrice,
                is_discounted: is_discounted === 'true',
                discount_amount: parseFloat(discount_amount),
                images: imageUrls,
                stock_quantity: parseInt(stock_quantity) || 0
            }])
            .select();

        if (productError) {
            console.error('Error adding product to database:', productError.message);
            return res.status(500).json({ error: 'Failed to add product to the database.' });
        }

        const productId = productData[0].id;

        // Link Product to Categories in `product_categories`
        if (parsedCategoryIds.length > 0) {
            const categoryEntries = parsedCategoryIds.map(category_id => ({ product_id: productId, category_id }));
            const { error: categoryLinkError } = await supabase
                .from('product_categories')
                .insert(categoryEntries);

            if (categoryLinkError) {
                console.error('Error linking product to categories:', categoryLinkError.message);
                return res.status(500).json({ error: 'Failed to link product to categories.' });
            }
        }

        // Link Product to Types in `product_types`
        if (parsedTypeIds.length > 0) {
            const typeEntries = parsedTypeIds.map(type_id => ({ product_id: productId, type_id }));
            const { error: typeLinkError } = await supabase
                .from('product_types')
                .insert(typeEntries);

            if (typeLinkError) {
                console.error('Error linking product to types:', typeLinkError.message);
                return res.status(500).json({ error: 'Failed to link product to types.' });
            }
        }

        // Link Product to Options in `product_options`
        if (parsedOptionIds.length > 0) {
            const optionEntries = parsedOptionIds.map(option_id => ({ product_id: productId, option_id }));
            const { error: optionLinkError } = await supabase
                .from('product_options')
                .insert(optionEntries);

            if (optionLinkError) {
                console.error('Error linking product to options:', optionLinkError.message);
                return res.status(500).json({ error: 'Failed to link product to options.' });
            }
        }

        // Respond with success
        res.status(201).json({
            message: 'Product added successfully!',
            product: productData[0]
        });
    } catch (err) {
        console.error('Unexpected Error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Delete Product
router.delete('/delete', async (req, res) => {
    const { product_id, user_id } = req.body; // Extract product ID and user ID

    // Validate input
    if (!product_id || !user_id) {
        return res.status(400).json({ error: 'Product ID and User ID are required to delete a product.' });
    }

    try {
        // Check Superuser Permissions
        const isSuper = await isSuperUser(user_id);
        if (!isSuper) {
            return res.status(403).json({ error: 'Only superusers are allowed to delete products.' });
        }

        // Fetch product details from the `products` table
        const { data: productData, error: productError } = await supabase
            .from('products')
            .select('images') // Fetch associated image URLs
            .eq('id', product_id)
            .single();

        if (productError || !productData) {
            console.error(`Error fetching product with ID ${product_id}:`, productError?.message || 'Product not found');
            return res.status(404).json({ error: `Product with ID ${product_id} not found.` });
        }

        const imageUrls = productData.images; // Array of image URLs

        // Delete images from Supabase Storage
        if (imageUrls && Array.isArray(imageUrls)) {
            try {
                const deletePromises = imageUrls.map(async (imageUrl) => {
                    const filePath = imageUrl.split('/storage/v1/object/public/images/')[1]; // Extract file path from URL
                    const { error: storageError } = await supabase.storage
                        .from('images')
                        .remove([filePath]);

                    if (storageError) {
                        console.error(`Error deleting image: ${filePath}`, storageError.message);
                    }
                });

                await Promise.all(deletePromises);
                console.log('All product images deleted successfully.');
            } catch (err) {
                console.error('Unexpected error during image deletion:', err.message);
            }
        }

        // Delete related records (categories, types, options)
        const deletionTasks = [
            supabase.from('product_categories').delete().eq('product_id', product_id),
            supabase.from('product_types').delete().eq('product_id', product_id),
            supabase.from('product_options').delete().eq('product_id', product_id),
        ];

        const deletionResults = await Promise.allSettled(deletionTasks);
        deletionResults.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.error(
                    `Error deleting ${
                        index === 0 ? 'categories' : index === 1 ? 'types' : 'options'
                    }:`,
                    result.reason.message
                );
            }
        });

        // Delete the product itself
        const { error: deleteProductError } = await supabase
            .from('products')
            .delete()
            .eq('id', product_id);

        if (deleteProductError) {
            console.error('Error deleting product from database:', deleteProductError.message);
            return res.status(500).json({ error: 'Failed to delete product from the database.' });
        }

        // Respond with success
        res.status(200).json({
            message: 'Product and all related data successfully deleted!',
        });
    } catch (err) {
        console.error('Unexpected error during product deletion:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch Product by ID
router.post('/fetch', async (req, res) => {
    const { product_id } = req.body; // Extract product_id from request body

    try {
        // Validate product_id
        if (!product_id || isNaN(product_id)) {
            return res.status(400).json({ error: 'A valid product ID is required.' });
        }

        // Fetch product details along with linked categories, types, and options
        const { data: product, error: productError } = await supabase
            .from('products')
            .select(`
                *,
                categories:product_categories (
                    category_id,
                    categories(name)
                ),
                types:product_types (
                    type_id,
                    types(type_name)
                ),
                options:product_options (
                    option_id,
                    options(option_name, type_id, types(type_name))
                )
            `)
            .eq('id', product_id)
            .single();

        if (productError || !product) {
            console.error('Error fetching product:', productError?.message || 'Product not found');
            return res.status(404).json({ error: 'Product not found.' });
        }

        // Format the product details for response
        const productDetails = {
            id: product.id,
            title: product.title,
            description: product.description,
            price: product.price,
            is_discounted: product.is_discounted,
            discount_amount: product.discount_amount,
            images: product.images,
            stock_quantity: product.stock_quantity,
            categories: product.categories.map(cat => ({
                id: cat.category_id,
                name: cat.categories.name,
            })),
            types: product.types.map(type => ({
                id: type.type_id,
                name: type.types.type_name,
            })),
            options: product.options.map(option => ({
                id: option.option_id,
                name: option.options.option_name,
                type_id: option.options.type_id,
                type_name: option.options.types.type_name,
            })),
            created_at: product.created_at,
            updated_at: product.updated_at,
        };

        // Respond with the detailed product data
        res.status(200).json({
            message: 'Product fetched successfully!',
            product: productDetails,
        });
    } catch (err) {
        console.error('Unexpected error in fetching product:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Update Product by ID
router.put('/update', upload.array('images', 5), async (req, res) => {
    const { 
      user_id,
      product_id,
      title,
      description,
      initial_price, // now coming from the client
      is_discounted,
      discount_amount,
      stock_quantity,
      category_ids,
      type_ids,
      option_ids
    } = req.body;
    const files = req.files;
  
    try {
      // Validate User ID and Product ID
      if (!user_id || !product_id) {
        return res.status(400).json({ error: 'User ID and Product ID are required to update a product.' });
      }
  
      // Check if the user is a superuser
      const isSuper = await isSuperUser(user_id);
      if (!isSuper) {
        return res.status(403).json({ error: 'Only superusers are allowed to update products.' });
      }
  
      // Fetch Existing Images from the product table
      const { data: productData, error: fetchError } = await supabase
        .from('products')
        .select('images')
        .eq('id', product_id)
        .single();
  
      if (fetchError || !productData) {
        return res.status(404).json({ error: 'Product not found.' });
      }
  
      const existingImages = productData.images || [];
  
      // Only remove old images if new image files are provided in this request
      if (files && files.length > 0 && existingImages.length > 0) {
        const deletePromises = existingImages.map(async (imageUrl) => {
          const filePath = imageUrl.split('/storage/v1/object/public/images/')[1]; // Extract file path from URL
          const { error: storageError } = await supabase.storage
            .from('images') // Ensure this matches your bucket name
            .remove([filePath]);
  
          if (storageError) {
            console.error(`Error deleting image: ${filePath}`, storageError.message);
          }
        });
  
        await Promise.all(deletePromises);
        console.log('All old images deleted successfully because new images were provided.');
      }
  
      // Handle New Image Uploads (only if files are provided)
      let newImageUrls = [];
      if (files && files.length > 0) {
        const uploadPromises = files.map(async (file) => {
          try {
            const imageUrl = await uploadImageToSupabase(file.buffer, file.originalname);
            newImageUrls.push(imageUrl);
          } catch (err) {
            console.error(`Error uploading image ${file.originalname}:`, err.message);
          }
        });
  
        await Promise.all(uploadPromises);
      }
  
      // Fields to update in the products table
      const fieldsToUpdate = {};
      if (title) fieldsToUpdate.title = title;
      if (description) fieldsToUpdate.description = description;
      
      // Instead of using client-sent "price", use "initial_price" to calculate the final price.
      if (initial_price !== undefined) {
        const parsedInitialPrice = parseFloat(initial_price);
        if (is_discounted === true || is_discounted === 'true') {
          const parsedDiscount = discount_amount ? parseFloat(discount_amount) : 0;
          const finalPrice = parsedInitialPrice - parsedDiscount;
          if (finalPrice < 0) {
            return res.status(400).json({ error: 'Discount amount cannot exceed the initial price.' });
          }
          fieldsToUpdate.price = finalPrice;
        } else {
          fieldsToUpdate.price = parsedInitialPrice;
        }
      }
      
      if (is_discounted !== undefined) {
        fieldsToUpdate.is_discounted = is_discounted;
      }
      if (discount_amount !== undefined) {
        fieldsToUpdate.discount_amount = discount_amount ? parseFloat(discount_amount) : null;
      }
      if (stock_quantity !== undefined) {
        fieldsToUpdate.stock_quantity = parseInt(stock_quantity);
      }
      // Only update images if new ones have been uploaded
      if (newImageUrls.length > 0) {
        fieldsToUpdate.images = newImageUrls;
      }
  
      // Update the product details in the products table
      const { error: productUpdateError } = await supabase
        .from('products')
        .update(fieldsToUpdate)
        .eq('id', product_id);
  
      if (productUpdateError) {
        console.error('Error updating product details:', productUpdateError.message);
        return res.status(500).json({ error: 'Failed to update product details.' });
      }
  
      // ---------------- Update Categories, Types, and Options in the junction tables ----------------
  
      // Update Categories (product_categories)
      if (category_ids) {
        // Delete old associations for this product
        const { error: deleteCatError } = await supabase
          .from('product_categories')
          .delete()
          .eq('product_id', product_id);
        if (deleteCatError) {
          console.error('Error deleting old product_categories:', deleteCatError.message);
        }
        // Insert new category associations (expecting an array of IDs)
        const categoryData = Array.isArray(category_ids) ? category_ids : JSON.parse(category_ids);
        const catRows = categoryData.map(cid => ({ product_id, category_id: cid }));
        const { error: insertCatError } = await supabase
          .from('product_categories')
          .insert(catRows);
        if (insertCatError) {
          console.error('Error inserting new product_categories:', insertCatError.message);
        }
      }
  
      // Update Types (product_types)
      if (type_ids) {
        const { error: deleteTypeError } = await supabase
          .from('product_types')
          .delete()
          .eq('product_id', product_id);
        if (deleteTypeError) {
          console.error('Error deleting old product_types:', deleteTypeError.message);
        }
        const typeData = Array.isArray(type_ids) ? type_ids : JSON.parse(type_ids);
        const typeRows = typeData.map(tid => ({ product_id, type_id: tid }));
        const { error: insertTypeError } = await supabase
          .from('product_types')
          .insert(typeRows);
        if (insertTypeError) {
          console.error('Error inserting new product_types:', insertTypeError.message);
        }
      }
  
      // Update Options (product_options)
      if (option_ids) {
        const { error: deleteOptionError } = await supabase
          .from('product_options')
          .delete()
          .eq('product_id', product_id);
        if (deleteOptionError) {
          console.error('Error deleting old product_options:', deleteOptionError.message);
        }
        const optionData = Array.isArray(option_ids) ? option_ids : JSON.parse(option_ids);
        const optionRows = optionData.map(oid => ({ product_id, option_id: oid }));
        const { error: insertOptionError } = await supabase
          .from('product_options')
          .insert(optionRows);
        if (insertOptionError) {
          console.error('Error inserting new product_options:', insertOptionError.message);
        }
      }
  
      // Successful Response
      res.status(200).json({ message: 'Product updated successfully!' });
    } catch (err) {
      console.error('Unexpected error while updating product:', err.message);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });  

// Fetch All Products
router.get('/list', async (req, res) => {
    try {
        // Query products along with relationships
        const { data: products, error: productError } = await supabase
            .from('products')
            .select(`
                id,
                title,
                description,
                price,
                is_discounted,
                discount_amount,
                images,
                stock_quantity,
                created_at,
                updated_at,
                categories:product_categories (
                    category_id,
                    categories(name)
                ),
                types:product_types (
                    type_id,
                    types(type_name)
                ),
                options:product_options (
                    option_id,
                    options(option_name, type_id, types(type_name))
                )
            `);

        if (productError) {
            console.error('Error fetching products:', productError.message);
            return res.status(500).json({ error: 'Failed to fetch products.' });
        }

        // Format the data for better readability
        const formattedProducts = products.map(product => ({
            id: product.id,
            title: product.title,
            description: product.description,
            price: product.price,
            is_discounted: product.is_discounted,
            discount_amount: product.discount_amount,
            images: product.images,
            stock_quantity: product.stock_quantity,
            created_at: product.created_at,
            updated_at: product.updated_at,
            categories: product.categories.map(cat => ({
                id: cat.category_id,
                name: cat.categories.name,
            })),
            types: product.types.map(type => ({
                id: type.type_id,
                name: type.types.type_name,
            })),
            options: product.options.map(option => ({
                id: option.option_id,
                name: option.options.option_name,
                type_id: option.options.type_id,
                type_name: option.options.types.type_name,
            })),
        }));

        // Respond with the formatted products
        res.status(200).json({
            message: 'Products fetched successfully!',
            products: formattedProducts,
        });
    } catch (err) {
        console.error('Unexpected Error in Fetching Products:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
