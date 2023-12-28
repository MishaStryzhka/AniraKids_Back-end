const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const getUserById = async (req, res, next) => {
  const { id } = req.params;

  const user = await User.findById(id);

  if (!user) {
    next(HttpError(404, 'Not found'));
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

module.exports = getUserById;
