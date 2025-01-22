const formatDate = date => {
  const dateArray = date.split('.');
  return `${dateArray[1]}.${dateArray[0]}.${dateArray[2]}`;
}; // 'MM.dd.yyyy'

module.exports = formatDate;
