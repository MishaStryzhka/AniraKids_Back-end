const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const updateCurrentUser = async (req, res, next) => {
  const { _id } = req.user;
  const {
    email,
    phones,
    educations,
    paymentMethods,
    jobs,
    problemsItSolves,
    directionsOfWork,
    contactMethods,
    links,
    communicationWithDoctor,
    howApplicationsAreReceived,
  } = req.body;

  console.log('req.body', req.body);

  const user = await User.findById(_id);
  if (!user) {
    next(HttpError(401, 'Not authorized'));
  }

  // -> Check if new phone number already exist
  if (phones) {
    const phonesArr = phones.split(',');

    // ===========================
    // !!!Потрібно допрацювати!!!
    // ===========================

    // let indexPhoneInUse = "";
    // const isPhoneExist = phonesArr.some((phone) => {
    //     indexPhoneInUse = user.phones.indexOf(phone);
    //     return user.phones.indexOf(phone) >= 0;
    // });
    // if (isPhoneExist) {
    //     throw HttpError(
    //         409,
    //         `Phone ${user.phones[indexPhoneInUse]} in use`
    //     );
    // }

    req.body.phones = phonesArr;
  }

  // -> Check if new communicationWithDoctor already exist
  if (communicationWithDoctor) {
    const communicationWithDoctorArr = communicationWithDoctor.split(',');
    req.body.communicationWithDoctor = communicationWithDoctorArr;
  }

  // -> Check if new communicationWithDoctor already exist
  if (howApplicationsAreReceived) {
    const howApplicationsAreReceivedArr = howApplicationsAreReceived.split(',');
    req.body.howApplicationsAreReceived = howApplicationsAreReceivedArr;
  }

  if (email) {
    throw HttpError(404, 'Not found');
  }

  // -> Add / Update educations
  let educationsArr;
  if (educations) {
    educationsArr = JSON.parse(req.body.educations);

    req.body.educations = educationsArr;
  }

  // -> Add / Update links
  let linksArr;
  if (links) {
    linksArr = JSON.parse(req.body.links);

    req.body.links = linksArr;
  }

  // -> Add / Update payment method
  if (paymentMethods) {
    const paymentMethodArr = paymentMethods.split(',');
    req.body.paymentMethods = paymentMethodArr;
  }

  // -> Add / Update Doctor job
  if (jobs) {
    // const a = [
    //   {
    //     name: 'DENTIST',
    //     cityArea: 'Kiev',
    //     address: 'Heroiv Urkainu 3',
    //     workSchedule: [{ begin: 9, end: 3 }],
    //     receptionHours: [{ begin: 11, end: 15 }],
    //   },
    // ];
    // console.log(JSON.stringify(a));
    req.body.jobs = JSON.parse(jobs);
  }

  // -> Set / Update User Avatar
  if (req.files.avatar) {
    req.body.avatar = req.files.avatar[0].path;
    req.body.avatarPublicId = req.files.avatar[0].filename;
  }

  // -> Set / Update User Certificates
  if (req.files.certificates) {
    req.body.certificates = [...req.user.certificates];
    req.files.certificates.map(el =>
      req.body.certificates.push({
        path: el.path,
        certificatePublicID: el.filename,
      })
    );
  }

  // -> Set / Update User WorkExamples
  if (req.files.workExamples) {
    req.body.workExamples = [...req.user.workExamples];
    req.files.workExamples.map(el =>
      req.body.workExamples.push({
        path: el.path,
        workExamplePublicID: el.filename,
      })
    );
  }

  // -> Set / Update Problems that doctor treat
  if (problemsItSolves) {
    req.body.problemsItSolves = JSON.parse(problemsItSolves);
  }

  // -> Set / Update Problems that doctor treat
  if (directionsOfWork) {
    req.body.directionsOfWork = JSON.parse(directionsOfWork);
  }

  // -> Check if new phone number already exist
  if (contactMethods) {
    const contactMethodsArr = contactMethods.split(',');

    req.body.contactMethods = contactMethodsArr;
  }

  const updatedUser = await User.findByIdAndUpdate(
    _id,
    { ...req.body },
    {
      new: true,
    }
  );

  console.log('updatedUser', updatedUser);

  res.status(200).json({
    user: {
      userID: updatedUser._id,
      email: updatedUser.email,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      patronymic: updatedUser.patronymic,
      phones: updatedUser.phones,
      userType: updatedUser.userType,
      experienceYears: updatedUser.experienceYears,
      avatar: updatedUser.avatar,
      educations: updatedUser.educations,
      paymentMethods: updatedUser.paymentMethods,
      jobs: updatedUser.jobs,
      certificates: updatedUser.certificates,
      workExamples: updatedUser.workExamples,
      directionsOfWork: updatedUser.directionsOfWork,
      problemsItSolves: updatedUser.problemsItSolves,
      contactMethods: updatedUser.contactMethods,
      dateOfBirthday: updatedUser.dateOfBirthday,
      links: updatedUser.links,
      communicationWithDoctor: updatedUser.communicationWithDoctor,
      howApplicationsAreReceived: updatedUser.howApplicationsAreReceived,
      isPublish: updatedUser.isPublish,
      receiveNotificationsAboutNewMessagesOnTheEmail:
        updatedUser.receiveNotificationsAboutNewMessagesOnTheEmail,
    },
  });
};

module.exports = updateCurrentUser;
