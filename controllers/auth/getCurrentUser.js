const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const getCurrentUser = async (req, res, next) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    next(HttpError(401, 'Not authorized'));
  }

  const {
    id: userID,
    userType,
    email,
    firstName,
    lastName,
    patronymic,
    dateOfBirthday,
    phones,
    contactMethods,
    directionsOfWork,
    problemsItSolves,
    avatar,
    provider,
    educations,
    jobs,
    certificates,
    workExamples,
    experienceYears,
    links,
    paymentMethods,
    communicationWithDoctor,
    howApplicationsAreReceived,
    isPublish,
    receiveNotificationsAboutNewMessagesOnTheEmail,
  } = user;

  res.status(200).json({
    user: {
      userID,
      userType,
      email,
      firstName,
      lastName,
      patronymic,
      dateOfBirthday,
      phones,
      contactMethods,
      directionsOfWork,
      problemsItSolves,
      avatar,
      provider,
      educations,
      jobs,
      certificates,
      workExamples,
      experienceYears,
      links,
      paymentMethods,
      communicationWithDoctor,
      howApplicationsAreReceived,
      isPublish,
      receiveNotificationsAboutNewMessagesOnTheEmail,
    },
  });
};

module.exports = getCurrentUser;
