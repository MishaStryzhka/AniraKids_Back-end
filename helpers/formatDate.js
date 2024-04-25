const formatDate = date => {
  const qwe = date.split('.');
  return `${qwe[1]}.${qwe[0]}.${qwe[2]}`;
}; // 'MM.dd.yyyy'

module.exports = formatDate;
