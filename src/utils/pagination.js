const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_LIMIT = 100;

const parsePagination = ({
  page = DEFAULT_PAGE,
  limit = DEFAULT_LIMIT,
  maxLimit = DEFAULT_MAX_LIMIT,
} = {}) => {
  const pageNum = Math.max(1, Number.parseInt(page, 10) || DEFAULT_PAGE);
  const rawLimit = Number.parseInt(limit, 10) || DEFAULT_LIMIT;
  const limitNum = Math.min(maxLimit, Math.max(1, rawLimit));

  return {
    page: pageNum,
    limit: limitNum,
    offset: (pageNum - 1) * limitNum,
  };
};

const buildPagination = ({ page, limit, totalItems }) => {
  const totalPages = Math.ceil(totalItems / limit) || 1;

  return {
    currentPage: page,
    limit,
    totalItems,
    totalPages,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  };
};

module.exports = {
  parsePagination,
  buildPagination,
};
