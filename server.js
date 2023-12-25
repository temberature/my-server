const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const { parseString } = require('xml2js');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// 用动态导入替换原来的 require
let fetch;

(async () => {
    fetch = (await import('node-fetch')).default;
})();

// 确保在 fetch 初始化之后使用它


const supabaseUrl = process.env.supabaseUrl;
const supabaseKey = process.env.supabaseKey;
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
app.use(cors());
app.use(bodyParser.json());

const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// Helper function to decode JWT and get user ID
const getUserIdFromToken = (token) => {
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return decoded.sub;
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            // Handle the specific case of an expired token
            return null;
        }
        throw error; // Re-throw other unexpected errors
    }
};

app.post('/upload', upload.single('file'), async (req, res) => {
    console.log(req.headers);
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('Authorization header is missing');
    }
    const userToken = authHeader.split(' ')[1];
    if (req.file) {
        const filePath = req.file.path;
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const userId = getUserIdFromToken(userToken);
        console.log(userId)
        if (!userId) {
            return res.status(401).send('Unauthorized');
        }

        try {
            const feeds = await handleOpmlFile(fileContent);
            if (!Array.isArray(feeds)) {
                throw new Error("handleOpmlFile did not return an array");
            }
    
            // Now use .map as feeds is confirmed to be an array
            const feedsData = feeds.map(feed => ({
                ...feed,
                user_id: userId
            }));
            const { data, error } = await supabase.from('feeds').insert(feedsData);
            if (error) throw error;

            res.send({ message: 'File processed successfully', data });
        } catch (error) {
            console.error('Error:', error);
            res.status(500).send('Error processing file');
        } finally {
            fs.unlinkSync(filePath);
        }
    } else {
        res.status(400).send('No file uploaded.');
    }
});

app.get('/feeds', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('Authorization header is missing');
    }
    const userToken = authHeader.split(' ')[1];

    const userId = getUserIdFromToken(userToken);

    if (!userId) {
        return res.status(401).send('Unauthorized');
    }

    const { data, error } = await supabase
        .from('feeds')
        .select('*')
        .eq('user_id', userId);

    if (error) {
        console.error('Error:', error);
        res.status(500).send('Server Error');
    } else {
        res.json(data);
    }
});
// 注册新用户
app.post('/auth/signup', async (req, res) => {
    const { email, password } = req.body;
    const { user, error } = await supabase.auth.signUp({ email, password });

    if (error) {
        return res.status(401).json({ error: error.message });
    }

    res.json({ user });
});

// 用户登录
app.post('/auth/signin', async (req, res) => {
    const { email, password } = req.body;

    try {
        const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();

        if (data.error) {
            res.status(401).json({ error: data.error.message });
        } else {
            res.json({ user: data.user, session: data.access_token });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).send('Internal server error');
    }
});
// 获取用户信息
app.get('/auth/user', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).send('No token provided');
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        res.json({ user: decoded }); // Send decoded token data as user info
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            res.status(401).send('Token expired');
        } else {
            res.status(401).send('Invalid token');
        }
    }
});

function parseOpmlToJson(opmlData) {
    let feeds = [];
    const outlines = opmlData.opml.body[0].outline;

    outlines.forEach(outline => {
        if (outline.outline) {
            outline.outline.forEach(feed => {
                feeds.push({
                    title: feed.$.text,
                    xmlurl: feed.$.xmlUrl,
                    htmlurl: feed.$.htmlUrl,
                    description: feed.$.description || ''
                });
            });
        }
    });

    return feeds;
}

function handleOpmlFile(fileContent) {
    return new Promise((resolve, reject) => {
        parseString(fileContent, (err, result) => {
            if (err) {
                reject(err);
            } else {
                const feeds = parseOpmlToJson(result);
                console.log("Feeds:", feeds); // Check the output here
                resolve(feeds);
            }
        });
    });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
