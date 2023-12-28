const { HttpError } = require("../../helpers");
const { User } = require("../../models");

const logout = async (req, res, next) => {
    const user = await User.findById(req.user._id)
    if(!user) {
        next(HttpError(401, "Not authorized"))
    }
    await User.findByIdAndUpdate(user._id, {token: ""});
    res.sendStatus(204);
};

module.exports = logout;