let express = require('express')
let app = express();
app.get('/say', function(req, res) {
  let { wd, callback } = req.query
  res.end(`${callback}('我不爱你')`)
})
app.listen(3000)

