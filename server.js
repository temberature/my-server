const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const { parseString } = require('xml2js');
require('dotenv').config();

const supabaseUrl = process.env.supabaseUrl;
const supabaseKey = process.env.supabaseKey;
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
app.use(cors());
app.use(bodyParser.json());

const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.single('file'), async (req, res) => {
    if (req.file) {
        const filePath = req.file.path;
        const fileContent = fs.readFileSync(filePath, 'utf8');

        try {
            const feeds = await handleOpmlFile(fileContent);
            const { data, error } = await supabase.from('feeds').insert(feeds);

            if (error) {
                console.error('Error uploading data to Supabase:', error);
                res.status(500).send('Error uploading data to Supabase');
            } else {
                res.send({ message: 'File processed successfully', data });
            }
        } catch (error) {
            console.error('Error parsing OPML file:', error);
            res.status(500).send('Error parsing OPML file');
        } finally {
            fs.unlinkSync(filePath);
        }
    } else {
        res.status(400).send('No file uploaded.');
    }
});

app.get('/feeds', async (req, res) => {
    const { data, error } = await supabase
        .from('feeds')
        .select('*');

    if (error) {
        console.error('Error fetching feeds:', error);
        res.status(500).send('Error fetching feeds');
    } else {
        res.json(data);
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
                resolve(feeds);
            }
        });
    });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
