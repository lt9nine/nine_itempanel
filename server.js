const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
require('dotenv').config();

// Check for required password
if (!process.env.PASSWORD) {
    console.error('Error: PASSWORD environment variable is required');
    process.exit(1);
}

// Generate session secret if not provided
if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = require('crypto').randomBytes(32).toString('hex');
    console.log('Generated new SESSION_SECRET:', process.env.SESSION_SECRET);
}

const app = express();
const port = process.env.PORT || 3000;

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads/images';
        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        // Accept only image files
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
            return cb(new Error('Only image files are allowed!'));
        }
        cb(null, true);
    }
});

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session.authenticated) {
        next();
    } else {
        res.redirect('/login.html');
    }
};

// Check authentication status endpoint
app.get('/check-auth', (req, res) => {
    res.json({ authenticated: !!req.session.authenticated });
});

// Protect all routes except login and check-auth
app.use((req, res, next) => {
    // Allow access to login page and check-auth endpoint
    if (req.path === '/login.html' || req.path === '/login' || req.path === '/check-auth') {
        return next();
    }
    // Protect all other routes
    requireAuth(req, res, next);
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { password } = req.body;
    
    try {
        if (password === process.env.PASSWORD) {
            req.session.authenticated = true;
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, message: 'Invalid password' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Logout endpoint
app.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Get the server's base URL
function getBaseUrl(req) {
    // Check for X-Forwarded-Proto header (for proxy support)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    // Check for X-Forwarded-Host header (for proxy support)
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${protocol}://${host}`;
}

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle image upload
app.post('/upload-image', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const baseUrl = getBaseUrl(req);
    res.json({ 
        url: `${baseUrl}/uploads/images/${req.file.filename}`,
        filename: req.file.filename
    });
});

// Get all items
app.get('/items.json', (req, res) => {
    try {
        const items = JSON.parse(fs.readFileSync('items.json', 'utf8'));
        res.json(items);
    } catch (error) {
        res.json([]);
    }
});

// Save items
app.post('/save-items', (req, res) => {
    try {
        fs.writeFileSync('items.json', JSON.stringify(req.body.items, null, 2));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save items' });
    }
});

// Generate Lua file
app.get('/generate-lua', (req, res) => {
    try {
        const items = JSON.parse(fs.readFileSync('items.json', 'utf8'));
        const baseUrl = getBaseUrl(req);
        
        let luaContent = 'return {\n';
        items.forEach(item => {
            luaContent += `    ['${item.name}'] = {\n`;
            luaContent += `        label = '${item.label}',\n`;
            if (item.weight) luaContent += `        weight = ${item.weight},\n`;
            if (item.degrade) luaContent += `        degrade = ${item.degrade},\n`;
            if (item.consume) luaContent += `        consume = ${item.consume},\n`;
            if (item.stack) luaContent += `        stack = true,\n`;
            
            if (item.client) {
                luaContent += '        client = {\n';
                if (item.client.anim) luaContent += `            anim = '${item.client.anim}',\n`;
                if (item.client.prop) luaContent += `            prop = '${item.client.prop}',\n`;
                if (item.client.usetime) luaContent += `            usetime = ${item.client.usetime},\n`;
                if (item.client.notification) luaContent += `            notification = '${item.client.notification}',\n`;
                if (item.client.image) luaContent += `            image = '${item.client.image}',\n`;
                if (item.client.imageurl) {
                    // Remove any existing base URL to prevent duplication
                    const imageUrl = item.client.imageurl.replace(/^https?:\/\/[^\/]+/, '');
                    luaContent += `            imageurl = '${baseUrl}${imageUrl}',\n`;
                }
                if (item.client.status) {
                    luaContent += '            status = {\n';
                    Object.entries(item.client.status).forEach(([statusKey, statusValue]) => {
                        luaContent += `                ['${statusKey}'] = ${statusValue},\n`;
                    });
                    luaContent += '            },\n';
                }
                luaContent += '        },\n';
            }
            
            if (item.server) {
                luaContent += '        server = {\n';
                if (item.server.export) luaContent += `            export = '${item.server.export}',\n`;
                luaContent += '        },\n';
            }
            
            if (item.buttons && item.buttons.length > 0) {
                luaContent += '        buttons = {\n';
                item.buttons.forEach(button => {
                    luaContent += '            {\n';
                    luaContent += `                label = '${button.label}',\n`;
                    luaContent += `                group = '${button.group}',\n`;
                    luaContent += `                action = '${button.action}',\n`;
                    luaContent += '            },\n';
                });
                luaContent += '        },\n';
            }
            
            luaContent += '    },\n';
        });
        luaContent += '}\n';
        
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', 'attachment; filename=items.lua');
        res.send(luaContent);
    } catch (error) {
        console.error('Error generating Lua file:', error);
        res.status(500).json({ error: 'Failed to generate Lua file' });
    }
});

// Delete image endpoint
app.delete('/delete-image', (req, res) => {
    const { imageUrl } = req.body;
    if (!imageUrl) {
        return res.status(400).json({ error: 'No image URL provided' });
    }

    try {
        // Extract filename from URL
        const filename = imageUrl.split('/').pop();
        const filepath = path.join(__dirname, 'uploads', 'images', filename);
        
        // Check if file exists
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Image file not found' });
        }
    } catch (error) {
        console.error('Error deleting image:', error);
        res.status(500).json({ error: 'Failed to delete image' });
    }
});

// Delete item endpoint
app.delete('/items/:index', (req, res) => {
    try {
        const index = parseInt(req.params.index);
        const items = JSON.parse(fs.readFileSync('items.json', 'utf8'));
        
        // Check if item has an imageurl that needs to be deleted
        if (items[index]?.client?.imageurl) {
            const imageUrl = items[index].client.imageurl;
            // Extract filename from URL
            const filename = imageUrl.split('/').pop();
            const filepath = path.join(__dirname, 'uploads', 'images', filename);
            
            // Delete the image file if it exists
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
        }
        
        items.splice(index, 1);
        fs.writeFileSync('items.json', JSON.stringify(items, null, 2));
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting item:', error);
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 