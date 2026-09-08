CREATE TABLE fd_departure_operations (
  id CHAR(36) PRIMARY KEY,
  fd_departure_date_id CHAR(36) NOT NULL UNIQUE,
  docs_collected_at DATETIME,
  supplier_coordination_at DATETIME,
  visa_processing_at DATETIME,
  driver_sent_at DATETIME,
  trip_live_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fd_departure_operations_departure FOREIGN KEY (fd_departure_date_id) REFERENCES fd_departure_dates(id)
);

CREATE INDEX idx_fd_departure_operations_departure ON fd_departure_operations(fd_departure_date_id);

CREATE TABLE fd_departure_supplier_logs (
  id CHAR(36) PRIMARY KEY,
  fd_departure_date_id CHAR(36) NOT NULL,
  supplier_name TEXT NOT NULL,
  item TEXT NOT NULL,
  status ENUM('pending', 'confirmed') NOT NULL DEFAULT 'pending',
  created_by_user_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fd_departure_supplier_logs_departure FOREIGN KEY (fd_departure_date_id) REFERENCES fd_departure_dates(id),
  CONSTRAINT fk_fd_departure_supplier_logs_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_fd_departure_supplier_logs_departure ON fd_departure_supplier_logs(fd_departure_date_id);

CREATE TABLE fd_departure_driver_dispatches (
  id CHAR(36) PRIMARY KEY,
  fd_departure_date_id CHAR(36) NOT NULL,
  driver_name TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  pickup_details TEXT NOT NULL,
  sent_by_user_id CHAR(36) NOT NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fd_departure_driver_dispatches_departure FOREIGN KEY (fd_departure_date_id) REFERENCES fd_departure_dates(id),
  CONSTRAINT fk_fd_departure_driver_dispatches_sent_by FOREIGN KEY (sent_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_fd_departure_driver_dispatches_departure ON fd_departure_driver_dispatches(fd_departure_date_id);

CREATE TABLE fd_departure_tour_updates (
  id CHAR(36) PRIMARY KEY,
  fd_departure_date_id CHAR(36) NOT NULL,
  update_type ENUM('itinerary_change', 'delay', 'general_notice') NOT NULL,
  message TEXT NOT NULL,
  published_by_user_id CHAR(36) NOT NULL,
  published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fd_departure_tour_updates_departure FOREIGN KEY (fd_departure_date_id) REFERENCES fd_departure_dates(id),
  CONSTRAINT fk_fd_departure_tour_updates_published_by FOREIGN KEY (published_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_fd_departure_tour_updates_departure ON fd_departure_tour_updates(fd_departure_date_id);
