ALTER TABLE fd_packages ADD COLUMN hotel_id CHAR(36);
ALTER TABLE fd_packages ADD CONSTRAINT fk_fd_packages_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id);
