const creds = require('./d.json');
const spreadsheetId = ""
const cellsWithData = "A1:J10"
const databaseUrl = "mongodb+srv://<username>:<password>@cluster0.cvyez.mongodb.net/<databasename>>?retryWrites=true&w=majority"
const adminTokens = [""]
const sheetName = "data"
const port = 5000

const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser")
const crypto = require("crypto")
const { GoogleSpreadsheet } = require('google-spreadsheet');

const doc = new GoogleSpreadsheet(spreadsheetId);
let sheet
doc.useServiceAccountAuth(creds).then(async () => {
    await doc.loadInfo()
    sheet = doc.sheetsByTitle[sheetName]
    sheet.loadCells(cellsWithData)
})

const monk = require("monk")
const db = monk(databaseUrl)

const users = db.get("users")
const groups = db.get("groups")

app.use(express.static("public"))
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())
app.use(cookieParser())

app.get("/", (req, res) => {
    if (req.cookies.token) {
        res.sendFile(__dirname + "/views/index.html")
    } else {
        res.redirect("/login")
    }
})

app.get("/register", (req, res) => {
    res.sendFile(__dirname + "/views/register.html")
})

app.get("/login", (req, res) => {
    res.sendFile(__dirname + "/views/login.html")
})

app.post("/api/newgroup", async (req, res) => {
    var { groupName, gameName } = req.body
    var usertoken = req.cookies.token
    var id = getToken(15)
    if (groupName && gameName && usertoken && adminTokens.find(r => r === usertoken)) {
        await groups.insert({ group: groupName, game: gameName, id: id, allowedUsers: [usertoken], counter: 0, cell: "A1" })
        res.redirect("/admin")
    } else {
        res.redirect("/admin?err=0")
    }
})

app.get("/admin", (req, res) => {
    if (adminTokens.find(r => r === req.cookies.token)) {
        res.sendFile(__dirname + "/views/admin.html")
    } else {
        res.sendStatus(404)
    }
})

app.get("/logout", (req, res) => {
    res.clearCookie("token")
    res.redirect("/")
})

app.post("/api/addaccess", async (req, res) => {
    if (adminTokens.find(r => r === req.cookies.token)) {
        var { email, id } = req.body
        var data = await groups.findOne({ id: id })
        var user = await users.findOne({ email: email })
        var token = user.token
        if (token) {
            var allowedUsers = data.allowedUsers
            if (!allowedUsers.find(r => r === token)) {
                allowedUsers.push(token)
            }
            await groups.findOneAndUpdate({ id: id }, { $set: { allowedUsers: allowedUsers } })
        }
        res.sendStatus(200)
    }
})

app.post("/api/removeaccess", async (req, res) => {
    if (adminTokens.find(r => r === req.cookies.token)) {
        var { email, id } = req.body
        var data = await groups.findOne({ id: id })
        var user = await users.findOne({ email: email })
        var token = user.token
        if (token) {
            var allowedUsers = data.allowedUsers
            if (allowedUsers.find(r => r === token)) {
                allowedUsers.splice(allowedUsers.indexOf(token), 1)
            }
            await groups.findOneAndUpdate({ id: id }, { $set: { allowedUsers: allowedUsers } })
        }
        res.sendStatus(200)
    }
})

app.get("/api/getgroups", async (req, res) => {
    var usertoken = req.cookies.token
    if (usertoken) {
        var data = await groups.find({})
        var toReturn = {}
        for (const group of data) {
            if (group.allowedUsers.find(r => r === usertoken)) {
                if (!toReturn[group.group]) {
                    toReturn[group.group] = []
                }
                toReturn[group.group].push({ name: group.game, id: group.id })
            }
        }
        var userdata = await users.findOne({ token: usertoken })
        res.json({ success: true, data: toReturn, username: userdata.username })
    } else {
        res.json({ success: false })
    }
})

app.get("/api/allgroups", async (req, res) => {
    if (adminTokens.find(r => r === req.cookies.token)) {
        var data = await groups.find({})
        var usersToUse = await users.find({})
        var toReturn = []
        for (const group of data) {
            var userData = []
            for (const usertoken of group.allowedUsers) {
                var foundData = usersToUse.find(r => r.token === usertoken)
                userData.push({ username: foundData.username, email: foundData.email })
            }
            toReturn.push({ group: group.group, game: group.game, id: group.id, cell: group.cell, users: userData })
        }
        res.json(toReturn)
    }
})

app.post("/api/savecell", async (req, res) => {
    if (adminTokens.find(r => r === req.cookies.token)) {
        await groups.findOneAndUpdate({ id: req.body.id }, { $set: { cell: req.body.cell } })
    }
    res.sendStatus(200)
})

app.get("/api/getgroupdata", async (req, res) => {
    var data = await groups.findOne({ id: req.query.id })
    if (data && data.allowedUsers.find(r => r === req.cookies.token)) {
        res.json({ success: true, name: `${data.group} - ${data.game}`, counter: data.counter })
    } else {
        res.json({ success: false })
    }
})

app.post("/api/savecounter", async (req, res) => {
    var data = await groups.findOne({ id: req.query.id })
    if (data && data.allowedUsers.find(r => r === req.cookies.token)) {
        await groups.findOneAndUpdate({ id: req.query.id }, { $set: { counter: req.body.counter } })
        var cell = sheet.getCellByA1(data.cell)
        cell.value = req.body.counter
        await sheet.saveUpdatedCells()
        res.json({ success: true })
    } else {
        res.json({ success: false })
    }
})

app.post("/api/register", async (req, res) => {
    var { username, email, password } = req.body
    var foundUsername = await users.findOne({ username: username })
    if (username && email && password) {
        if (foundUsername) {
            res.redirect("/register?err=1")
        } else {
            var foundEmail = await users.findOne({ email: email })
            if (foundEmail) {
                res.redirect("/register?err=2")
            } else {
                var hashedPassword = getHash(password, email)
                var token = getToken()
                await users.insert({ username: username, email: email, password: hashedPassword, token: token })
                res.redirect("/login")
            }
        }
    } else {
        res.redirect("/register?err=0")
    }
})

app.post("/api/login", async (req, res) => {
    var { email, password, keepLogged } = req.body
    var data = await users.findOne({ email: email, password: getHash(password, email) })
    if (data) {
        if (keepLogged) {
            res.cookie("token", data.token, { maxAge: 1000 * 60 * 60 * 24 * 30 })
        } else {
            res.cookie("token", data.token)
        }
        res.redirect("/")
    } else {
        res.redirect("/login?err=0")
    }
})

app.get("/group/*", (req, res) => {
    res.sendFile(__dirname + "/views/group.html")
})

app.listen(port, () => { console.log("Listening on :" + port) })
db.then(() => {
    console.log("Successfully connected to database")
})

function getHash(password, salt) {
    let hash = crypto.createHash("sha256")
        .update(password)
        .update(makeHash(salt))
        .digest("base64");
    return hash
}
function makeHash(val) {
    return crypto.createHash('sha256').update(val).digest();
}
const alphabet = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
function getToken(length) {
    if (!length) {
        length = 40
    }
    var token = "";
    for (var i = 0; i < length; i++) {
        token += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return token
}
